import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { getGuildGiveaways, saveGiveaway } from '../../utils/giveaways.js';
import {
    createGiveawayEmbed,
    createGiveawayButtons
} from '../../services/giveawayService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("gsetwinner")
        .setDescription("Imposta manualmente il vincitore di un giveaway.")
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription("L'ID del messaggio del giveaway.")
                .setRequired(true),
        )
        .addUserOption((option) =>
            option
                .setName("winner")
                .setDescription("Il nuovo vincitore del giveaway.")
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
                    "You need the 'Manage Server' permission to set a giveaway winner.",
                    { userId: interaction.user.id, guildId: interaction.guildId }
                );
            }

            logger.info(`Giveaway setwinner initiated by ${interaction.user.tag} in guild ${interaction.guildId}`);

            const messageId = interaction.options.getString("messageid");
            const winner = interaction.options.getUser("winner");

            if (!messageId || !/^\d+$/.test(messageId)) {
                throw new TitanBotError(
                    'Invalid message ID format',
                    ErrorTypes.VALIDATION,
                    'Please provide a valid message ID.',
                    { providedId: messageId }
                );
            }

            const giveaways = await getGuildGiveaways(interaction.client, interaction.guildId);
            const giveaway = giveaways.find(g => g.messageId === messageId);

            if (!giveaway) {
                throw new TitanBotError(
                    `Giveaway not found: ${messageId}`,
                    ErrorTypes.VALIDATION,
                    "No giveaway was found with that message ID in the database.",
                    { messageId, guildId: interaction.guildId }
                );
            }

            const newWinners = [winner.id];

            const updatedGiveaway = {
                ...giveaway,
                winnerIds: newWinners,
                isEnded: true,
                ended: true,
                endedAt: giveaway.endedAt || new Date().toISOString(),
                manualWinnerSetAt: new Date().toISOString(),
                manualWinnerSetBy: interaction.user.id
            };

            await saveGiveaway(
                interaction.client,
                interaction.guildId,
                updatedGiveaway,
            );

            const channel = await interaction.client.channels.fetch(
                giveaway.channelId,
            ).catch(err => {
                logger.warn(`Could not fetch channel ${giveaway.channelId}:`, err.message);
                return null;
            });

            const winnerMentions = newWinners
                .map((id) => `<@${id}>`)
                .join(", ");

            if (!channel || !channel.isTextBased()) {
                return InteractionHelper.safeReply(interaction, {
                    embeds: [
                        successEmbed(
                            "Vincitore Impostato",
                            "Il vincitore è stato salvato nel database. Impossibile trovare il canale per l'annuncio.",
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

            if (message) {
                const newEmbed = createGiveawayEmbed(updatedGiveaway, "ended", newWinners);
                const newRow = createGiveawayButtons(true);

                await message.edit({
                    content: "🎉 **GIVEAWAY TERMINATO** 🎉",
                    embeds: [newEmbed],
                    components: [newRow],
                }).catch(err => {
                    logger.warn(`Could not edit giveaway message ${messageId}:`, err.message);
                });
            }

            const existingPingMsg = giveaway.winnerPingMessageId
                ? await channel.messages.fetch(giveaway.winnerPingMessageId).catch(() => null)
                : null;

            if (existingPingMsg) {
                await existingPingMsg.edit({
                    content: `🎉 CONGRATULAZIONI ${winnerMentions}! Sei il vincitore del giveaway **${giveaway.prize}**! Contatta l'host <@${giveaway.hostId}> per ritirare il tuo premio.`,
                    allowedMentions: { users: newWinners },
                });
            } else {
                const newPingMsg = await channel.send({
                    content: `🎉 CONGRATULAZIONI ${winnerMentions}! Sei il vincitore del giveaway **${giveaway.prize}**! Contatta l'host <@${giveaway.hostId}> per ritirare il tuo premio.`,
                    allowedMentions: { users: newWinners },
                });
                updatedGiveaway.winnerPingMessageId = newPingMsg.id;
                await saveGiveaway(interaction.client, interaction.guildId, updatedGiveaway);
            }

            logger.info(`Giveaway winner manually set: ${messageId} -> ${winner.id}`);

            try {
                await logEvent({
                    client: interaction.client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.GIVEAWAY_WINNER,
                    data: {
                        description: `Vincitore impostato manualmente per: ${giveaway.prize}`,
                        channelId: giveaway.channelId,
                        userId: interaction.user.id,
                        fields: [
                            {
                                name: 'Premio',
                                value: giveaway.prize || 'Premio Misterioso!',
                                inline: true
                            },
                            {
                                name: 'Vincitore',
                                value: winnerMentions,
                                inline: false
                            }
                        ]
                    }
                });
            } catch (logError) {
                logger.debug('Error logging manual giveaway winner:', logError);
            }

            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    successEmbed(
                        "Vincitore Impostato ✅",
                        `${winnerMentions} è stato impostato come vincitore del giveaway per **${giveaway.prize}** in ${channel}.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {
            logger.error('Error in gsetwinner command:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'gsetwinner',
                context: 'giveaway_setwinner'
            });
        }
    },
};
