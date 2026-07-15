import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
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
        .setDescription("Manually sets the winner of a giveaway, during or after it ends.")
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription("The message ID of the giveaway.")
                .setRequired(true),
        )
        .addUserOption((option) =>
            option
                .setName("utente")
                .setDescription("The user to declare as the winner.")
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

            logger.info(`Giveaway manual winner set initiated by ${interaction.user.tag} in guild ${interaction.guildId}`);

            const messageId = interaction.options.getString("messageid");
            const chosenUser = interaction.options.getUser("utente");

            if (!messageId || !/^\d+$/.test(messageId)) {
                throw new TitanBotError(
                    'Invalid message ID format',
                    ErrorTypes.VALIDATION,
                    'Please provide a valid message ID.',
                    { providedId: messageId }
                );
            }

            if (chosenUser.bot) {
                throw new TitanBotError(
                    'Chosen winner is a bot',
                    ErrorTypes.VALIDATION,
                    'You cannot set a bot as the giveaway winner.',
                    { userId: chosenUser.id }
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

            const newWinners = [chosenUser.id];

            const updatedGiveaway = {
                ...giveaway,
                winnerIds: newWinners,
                rerolledAt: new Date().toISOString(),
                rerolledBy: interaction.user.id,
                manualWinnerSet: true,
                isEnded: true,
                ended: true,
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

                logger.warn(`Could not find channel for giveaway ${messageId}, but saved manual winner to database`);

                return InteractionHelper.safeReply(interaction, {
                    embeds: [
                        successEmbed(
                            "Winner Set",
                            `<@${chosenUser.id}> has been set as the winner and saved to the database. Could not find channel to announce.`,
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

            const winnerMention = `<@${chosenUser.id}>`;

            if (message) {
                const newEmbed = createGiveawayEmbed(updatedGiveaway, "reroll", newWinners);
                const newRow = createGiveawayButtons(true);

                await message.edit({
                    content: "🏆 **WINNER** 🏆",
                    embeds: [newEmbed],
                    components: [newRow],
                });
            } else {
                logger.warn(`Could not find message ${messageId} for giveaway, announcing without editing it`);
            }

            await saveGiveaway(
                interaction.client,
                interaction.guildId,
                updatedGiveaway,
            );

            const existingPingMsg = giveaway.winnerPingMessageId
                ? await channel.messages.fetch(giveaway.winnerPingMessageId).catch(() => null)
                : null;

            if (existingPingMsg) {
                await existingPingMsg.edit({
                    content: `🏆 **WINNER** 🏆 CONGRATULATIONS ${winnerMention}! You have been declared the winner of the **${giveaway.prize}** giveaway! Please contact the host <@${giveaway.hostId}> to claim your prize.`,
                });
            } else {
                const newPingMsg = await channel.send({
                    content: `🏆 **WINNER** 🏆 CONGRATULATIONS ${winnerMention}! You have been declared the winner of the **${giveaway.prize}** giveaway! Please contact the host <@${giveaway.hostId}> to claim your prize.`,
                });
                updatedGiveaway.winnerPingMessageId = newPingMsg.id;
                await saveGiveaway(interaction.client, interaction.guildId, updatedGiveaway);
            }

            logger.info(`Giveaway winner manually set: ${messageId} -> ${chosenUser.id}`);

            try {
                await logEvent({
                    client: interaction.client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.GIVEAWAY_REROLL,
                    data: {
                        description: `Giveaway winner manually set: ${giveaway.prize}`,
                        channelId: giveaway.channelId,
                        userId: interaction.user.id,
                        fields: [
                            {
                                name: 'Prize',
                                value: giveaway.prize || 'Mystery Prize!',
                                inline: true
                            },
                            {
                                name: 'Winner',
                                value: winnerMention,
                                inline: false
                            },
                            {
                                name: 'Set By',
                                value: `<@${interaction.user.id}>`,
                                inline: true
                            }
                        ]
                    }
                });
            } catch (logError) {
                logger.debug('Error logging manual giveaway winner event:', logError);
            }

            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    successEmbed(
                        "Winner Set ✅",
                        `Successfully set ${winnerMention} as the winner of **${giveaway.prize}** in ${channel}.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {
            logger.error('Error in gsetwinner command:', error);
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'gsetwinner',
                context: 'giveaway_set_winner'
            });
        }
    },
};
