import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { getGuildGiveaways, saveGiveaway } from '../../utils/giveaways.js';
import { 
    endGiveaway as endGiveawayService,
    createGiveawayEmbed, 
    createGiveawayButtons 
} from '../../services/giveawayService.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("gend")
        .setDescription(
            "Ends an active giveaway immediately and picks the winner(s).",
        )
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription("The message ID of the giveaway to end.")
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
                    "You need the 'Manage Server' permission to end a giveaway.",
                    { userId: interaction.user.id, guildId: interaction.guildId }
                );
            }

            logger.info(`Giveaway end initiated by ${interaction.user.tag} in guild ${interaction.guildId}`);

            const messageId = interaction.options.getString("messageid");

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

            const endResult = await endGiveawayService(
                interaction.client,
                giveaway,
                interaction.guildId,
                interaction.user.id
            );

            const updatedGiveaway = endResult.giveaway;
            const winners = endResult.winners;

            const channel = await interaction.client.channels.fetch(
                updatedGiveaway.channelId,
            ).catch(err => {
                logger.warn(`Could not fetch channel ${updatedGiveaway.channelId}:`, err.message);
                return null;
            });

            if (!channel || !channel.isTextBased()) {
                throw new TitanBotError(
                    `Channel not found: ${updatedGiveaway.channelId}`,
                    ErrorTypes.VALIDATION,
                    "Could not find the channel where the giveaway was hosted. The giveaway state has been updated.",
                    { channelId: updatedGiveaway.channelId, messageId }
                );
            }

            const message = await channel.messages
                .fetch(messageId)
                .catch(err => {
                    logger.warn(`Could not fetch message ${messageId}:`, err.message);
                    return null;
                });

            if (!message) {
                throw new TitanBotError(
                    `Message not found: ${messageId}`,
                    ErrorTypes.VALIDATION,
                    "Could not find the giveaway message. The giveaway state has been updated.",
                    { messageId, channelId: updatedGiveaway.channelId }
                );
            }

            await saveGiveaway(
                interaction.client,
                interaction.guildId,
                updatedGiveaway,
            );

            const newEmbed = createGiveawayEmbed(updatedGiveaway, "ended", winners);
            const newRow = createGiveawayButtons(true);

            await message.edit({
                content: "🎉 **GIVEAWAY TERMINATO** 🎉",
                embeds: [newEmbed],
                components: [newRow],
            });

            if (winners.length > 0) {
                const winnerMentions = winners
                    .map((id) => `<@${id}>`)
                    .join(", ");
                const winnerPingMsg = await channel.send({
                    content: `🎉 CONGRATULAZIONI ${winnerMentions}! Hai vinto il **${updatedGiveaway.prize}** giveaway! Perfavore contatta <@${updatedGiveaway.hostId}> per ricevere il tuo premi[...]
                    allowedMentions: { users: winners },
                });
                updatedGiveaway.winnerPingMessageId = winnerPingMsg.id;
                await saveGiveaway(interaction.client, interaction.guildId, updatedGiveaway);

                logger.info(`Giveaway ended with ${winners.length} winner(s): ${messageId}`);

                // Esegui operazioni non-critiche in background (fire and forget)
                // Questo evita di bloccare la risposta all'utente
                Promise.allSettled([
                    // Invia DM a tutti i vincitori in parallelo (non sequenziale)
                    ...winners.map(winnerId =>
                        interaction.client.users.fetch(winnerId)
                            .then(user => user.send({
                                content: `🎉 Congratulazioni! Hai vinto il giveaway **${updatedGiveaway.prize}** su ${interaction.guild?.name || 'il server'}. Per ritirare il premio contatta l'host[...]`
                            }))
                            .then(() => {
                                logger.debug(`DM sent successfully to ${winnerId}`);
                                return winnerId;
                            })
                            .catch(err => {
                                logger.warn(`Could not send DM to winner ${winnerId}: ${err.message}`);
                                throw winnerId;
                            })
                    ),
                    // Log event in background
                    logEvent({
                        client: interaction.client,
                        guildId: interaction.guildId,
                        eventType: EVENT_TYPES.GIVEAWAY_WINNER,
                        data: {
                            description: `Giveaway terminato con ${winners.length} vincitore(i)`,
                            channelId: channel.id,
                            userId: interaction.user.id,
                            fields: [
                                {
                                    name: 'Premio',
                                    value: updatedGiveaway.prize || 'Premio Misterioso!',
                                    inline: true
                                },
                                {
                                    name: 'Vincitori',
                                    value: winnerMentions,
                                    inline: false
                                },
                                {
                                    name: 'Partecipanti',
                                    value: endResult.participantCount.toString(),
                                    inline: true
                                }
                            ]
                        }
                    }).catch(logErr => logger.debug('Error logging giveaway winner event:', logErr))
                ]).catch(err => logger.error('Background operations error:', err));

            } else {
                await channel.send({
                    content: `Il giveaway per **${updatedGiveaway.prize}** è terminato senza partecipanti validi.`,
                });
                logger.info(`Giveaway ended with no winners: ${messageId}`);
            }

            logger.info(`Giveaway successfully ended by ${interaction.user.tag}: ${messageId}`);

            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    successEmbed(
                        "Giveaway Terminato ✅",
                        `Giveaway per **${updatedGiveaway.prize}** terminato con successo in ${channel}. ${winners.length} vincitore(i) selezionato(i) da ${endResult.participantCount} partecipant[...]
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'gend',
                context: 'giveaway_end'
            });
        }
    },
};
