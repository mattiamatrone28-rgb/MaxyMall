import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } from 'discord.js';
import { errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { getGuildGiveaways } from '../../utils/giveaways.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getColor } from '../../config/bot.js';

// Quante menzioni utente inserire in ogni field dell'embed
// (i field hanno un limite di 1024 caratteri, una mention tipo <@123456789012345678> ne usa ~22)
const MENTIONS_PER_FIELD = 40;
// Discord permette al massimo 25 field per embed
const MAX_FIELDS = 25;

export default {
    data: new SlashCommandBuilder()
        .setName("gparticipants")
        .setDescription("Shows the list of participants for a giveaway.")
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription("The message ID of the giveaway.")
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
                    "You need the 'Manage Server' permission to view giveaway participants.",
                    { userId: interaction.user.id, guildId: interaction.guildId }
                );
            }

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

            // Dedup difensivo, non dovrebbe mai servire ma evita conteggi errati
            // se la lista contenesse duplicati per qualche motivo.
            const participants = [...new Set(giveaway.participants || [])];

            const embed = new EmbedBuilder()
                .setColor(getColor("giveaway.active"))
                .setTitle(`🎉 Participants — ${giveaway.prize || 'Mystery Prize!'}`)
                .setFooter({ text: `Message ID: ${messageId}` })
                .setTimestamp();

            if (participants.length === 0) {
                embed.setDescription('No one has entered this giveaway yet.');
            } else {
                embed.setDescription(`**Total entries:** ${participants.length}`);

                const chunks = [];
                for (let i = 0; i < participants.length; i += MENTIONS_PER_FIELD) {
                    chunks.push(participants.slice(i, i + MENTIONS_PER_FIELD));
                }

                const visibleChunks = chunks.slice(0, MAX_FIELDS);

                visibleChunks.forEach((chunk, index) => {
                    embed.addFields({
                        name: chunks.length > 1 ? `Entries ${index * MENTIONS_PER_FIELD + 1}-${index * MENTIONS_PER_FIELD + chunk.length}` : 'Entries',
                        value: chunk.map(id => `<@${id}>`).join(', '),
                    });
                });

                if (chunks.length > visibleChunks.length) {
                    const remaining = participants.length - (visibleChunks.length * MENTIONS_PER_FIELD);
                    embed.addFields({
                        name: 'Note',
                        value: `...and ${remaining} more entr${remaining === 1 ? 'y' : 'ies'} not shown (embed limit reached).`,
                    });
                }
            }

            logger.debug(`Participants list viewed for giveaway ${messageId} by ${interaction.user.tag}`);

            await InteractionHelper.safeReply(interaction, {
                embeds: [embed],
                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'gparticipants',
                context: 'giveaway_participants'
            });
        }
    },
};
