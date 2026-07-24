import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { getGuildGiveaways, saveGiveaway } from '../../utils/giveaways.js';
import { 
    selectWinners,
    createGiveawayEmbed, 
    createGiveawayButtons 
} from '../../services/giveawayService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("greroll")
        .setDescription("Rerolls the winner(s) for an ended giveaway.")
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription("The message ID of the ended giveaway.")
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        try {
            
            if (!interaction.inGuild()) {
                throw new TitanBotError(
                    'Giveaway command used outside guild',
                    ErrorTypes.VALIDATION,
                    'This command can only be used in a server.',
                    { userId: interaction.user.id }
                );
            }

            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw new TitanBotError(
                    'User lacks ManageGuild permission',
                    ErrorTypes.PERMISSION,
                    "You need the 'Manage Server' permission to reroll a giveaway.",
                    { userId: interaction.user.id, guildId: interaction.guildId }
                );
            }

            logger.info(`Giveaway reroll initiated by ${interaction.user.tag} in guild ${interaction.guildId}`);

            const messageId = interaction.options.getString("messageid");

            if (!messageId || !/^\d+$/.test(messageId)) {
                throw new TitanBotError(
                    'Invalid message ID format',
                    ErrorTypes.VALIDATION,
                    'Please provide a valid message ID.',
                    { providedId: messageId }
                );
            }

            const giveaways = await getGuildGiveaways(
                interaction.client,
                interaction.guildId,
            );

            const giveaway = giveaways.find(g => g.messageId === messageId);

            if (!giveaway) {
                throw new TitanBotError(
                    `Giveaway not found: ${messageId}`,
                    ErrorTypes.VALIDATION,
                    "No giveaway was found with that message ID in the database.",
                    { messageId, guildId: interaction.guildId }
                );
            }

            if (!giveaway.isEnded && !giveaway.ended) {
                throw new TitanBotError(
                    `Giveaway still active: ${messageId}`,
                    ErrorTypes.VALIDATION,
                    "This giveaway is still active. Please use `/gend` to end it first.",
                    { messageId, status: 'active' }
                );
            }

            const participants = giveaway.participants || [];
            
            if (participants.length < giveaway.winnerCount) {
                throw new TitanBotError(
                    `Insufficient participants for reroll: ${participants.length} < ${giveaway.winnerCount}`,
                    ErrorTypes.VALIDATION,
                    "Not enough entries to pick the required number of winners.",
                    { participantsCount: participants.length, winnersNeeded: giveaway.winnerCount }
                );
            }

            const newWinners = selectWinners(
                participants,
                giveaway.winnerCount,
            );

            const updatedGiveaway = {
                ...giveaway,
                winnerIds: newWinners,
                rerolledAt: new Date().toISOString(),
                rerolledBy: interaction.user.id
            };

            const channel = await interaction.client.channels.fetch(
                giveaway.channelId,
            ).catch(err => {
                logger.warn(`Could not fetch channel ${giveaway.channelId}:`, err.message);
                return null;
            });

            if (!channel || !channel.isTextBased()) {
                
                await saveGiveaway(
                    interaction.client,
                    interaction.guildId,
                    updatedGiveaway,
                );
                
                logger.warn(`Could not find channel for giveaway ${messageId}, but saved new winners to database`);
                
                return InteractionHelper.safeReply(interaction, {
                    embeds: [
                        successEmbed(
                            "Reroll Completato",
                            "I nuovi vincitori sono stati selezionati e salvati nel database. Impossibile trovare il canale per l'annuncio.",
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            const message = await channel.messages
                .fetch(messageId)
                .catch(err => {
                    logger.warn(`Could not fetch message ${messageId}:`, err.message);
                    return null;
                });

            if (!message) {
                
                await saveGiveaway(
                    interaction.client,
                    interaction.guildId,
                    updatedGiveaway,
                );

                const winnerMentions = newWinners
                    .map((id) => `<@${id}>`)
                    .join(", ");

                const existingPingMsg = giveaway.winnerPingMessageId
                    ? await channel.messages.fetch(giveaway.winnerPingMessageId).catch(() => null)
                    : null;
                if (existingPingMsg) {
                    await existingPingMsg.edit({
                        content: `🔄 **REROLL DEL GIVEAWAY** 🔄 Nuovo/i vincitore/i per **${giveaway.prize}**: ${winnerMentions}!`,
                        allowedMentions: { users: newWinners },
                    });
                } else {
                    const newPingMsg = await channel.send({
                        content: `🔄 **REROLL DEL GIVEAWAY** 🔄 Nuovo/i vincitore/i per **${giveaway.prize}**: ${winnerMentions}!`,
                        allowedMentions: { users: newWinners },
                    });
                    updatedGiveaway.winnerPingMessageId = newPingMsg.id;
                }

                logger.info(`Giveaway rerolled (message not found, but announced): ${messageId}`);

                try {
                    await logEvent({
                        client: interaction.client,
                        guildId: interaction.guildId,
                        eventType: EVENT_TYPES.GIVEAWAY_REROLL,
                        data: {
                            description: `Giveaway rerollato: ${giveaway.prize}`,
                            channelId: giveaway.channelId,
                            userId: interaction.user.id,
                            fields: [
                                {
                                    name: 'Premio',
                                    value: giveaway.prize || 'Premio Misterioso!',
                                    inline: true
                                },
                                {
                                    name: 'Nuovi Vincitori',
                                    value: winnerMentions,
                                    inline: false
                                },
                                {
                                    name: 'Partecipanti Totali',
                                    value: participants.length.toString(),
                                    inline: true
                                }
                            ]
                        }
                    });
                } catch (logError) {
                    logger.debug('Error logging giveaway reroll:', logError);
                }

                return InteractionHelper.safeReply(interaction, {
                    embeds: [
                        successEmbed(
                            "Reroll Completato",
                            `I nuovi vincitori sono stati annunciati in ${channel}. (Messaggio originale non trovato).`,
                        ),
                    ],
                    flags: MessageFlags.Ephemeral,
                });
            }

            await saveGiveaway(
                interaction.client,
                interaction.guildId,
                updatedGiveaway,
            );

            const newEmbed = createGiveawayEmbed(updatedGiveaway, "reroll", newWinners);
            const newRow = createGiveawayButtons(true);

            await message.edit({
                content: "🔄 **GIVEAWAY REROLLATO** 🔄",
                embeds: [newEmbed],
                components: [newRow],
            });

            const winnerMentions = newWinners
                .map((id) => `<@${id}>`)
                .join(", ");

            const existingPingMsg = giveaway.winnerPingMessageId
                ? await channel.messages.fetch(giveaway.winnerPingMessageId).catch(() => null)
                : null;
            if (existingPingMsg) {
                await existingPingMsg.edit({
                    content: `🔄 **NUOVI VINCITORI (REROLL)** 🔄 CONGRATULAZIONI ${winnerMentions}! Sei il nuovo vincitore (o uno dei nuovi vincitori) del giveaway **${giveaway.prize}**! Contatta l'host <@${giveaway.hostId}> per ritirare il tuo premio.`,
                    allowedMentions: { users: newWinners },
                });
            } else {
                const newPingMsg = await channel.send({
                    content: `🔄 **NUOVI VINCITORI (REROLL)** 🔄 CONGRATULAZIONI ${winnerMentions}! Sei il nuovo vincitore (o uno dei nuovi vincitori) del giveaway **${giveaway.prize}**! Contatta l'host <@${giveaway.hostId}> per ritirare il tuo premio.`,
                    allowedMentions: { users: newWinners },
                });
                updatedGiveaway.winnerPingMessageId = newPingMsg.id;
            }

            logger.info(`Giveaway successfully rerolled: ${messageId} with ${newWinners.length} new winners`);

            try {
                await logEvent({
                    client: interaction.client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.GIVEAWAY_REROLL,
                    data: {
                        description: `Giveaway rerollato: ${giveaway.prize}`,
                        channelId: giveaway.channelId,
                        userId: interaction.user.id,
                        fields: [
                            {
                                name: 'Premio',
                                value: giveaway.prize || 'Premio Misterioso!',
                                inline: true
                            },
                            {
                                name: 'Nuovi Vincitori',
                                value: winnerMentions,
                                inline: false
                            },
                            {
                                name: 'Partecipanti Totali',
                                value: participants.length.toString(),
                                inline: true
                            }
                        ]
                    }
                });
            } catch (logError) {
                logger.debug('Error logging giveaway reroll event:', logError);
            }

            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    successEmbed(
                        "Reroll Riuscito ✅",
                        `Reroll del giveaway per **${giveaway.prize}** eseguito con successo in ${channel}. Selezionato/i ${newWinners.length} nuovo/i vincitore/i.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {
            logger.error('Error in greroll command:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'greroll',
                context: 'giveaway_reroll'
            });
        }
    },
};
