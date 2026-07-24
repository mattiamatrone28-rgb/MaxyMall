import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes, handleInteractionError } from '../../utils/errorHandler.js';
import { getGuildGiveaways, saveGiveaway } from '../../utils/giveaways.js';
import { logEvent, EVENT_TYPES } from '../../services/loggingService.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName("gforcewinner")
        .setDescription(
            "Sets the winner(s) of an active giveaway in advance. The giveaway still ends when its timer expires.",
        )
        .addStringOption((option) =>
            option
                .setName("messageid")
                .setDescription("The message ID of the giveaway.")
                .setRequired(true),
        )
        .addStringOption((option) =>
            option
                .setName("utenti")
                .setDescription("Menziona uno o più utenti da impostare come vincitori.")
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

            const messageId = interaction.options.getString("messageid");
            const utentiInput = interaction.options.getString("utenti");

            if (!messageId || !/^\d+$/.test(messageId)) {
                throw new TitanBotError(
                    'Invalid message ID format',
                    ErrorTypes.VALIDATION,
                    'Please provide a valid message ID.',
                    { providedId: messageId }
                );
            }

            const winnerIds = [...new Set((utentiInput.match(/\d{15,}/g) || []))];

            if (winnerIds.length === 0) {
                throw new TitanBotError(
                    'No valid user mentions provided',
                    ErrorTypes.VALIDATION,
                    'Devi menzionare almeno un utente valido (es. @utente).',
                    { providedInput: utentiInput }
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

            if (giveaway.ended === true || giveaway.isEnded === true) {
                throw new TitanBotError(
                    `Giveaway ${messageId} is already ended`,
                    ErrorTypes.VALIDATION,
                    'Questo giveaway è già terminato, non puoi impostarne il vincitore.',
                    { messageId }
                );
            }

            const winnerCount = giveaway.winnerCount || 1;
            const cappedWinnerIds = winnerIds.slice(0, winnerCount);

            const updatedGiveaway = {
                ...giveaway,
                forcedWinnerIds: cappedWinnerIds,
                forcedBy: interaction.user.id,
                forcedAt: new Date().toISOString(),
            };

            const saved = await saveGiveaway(
                interaction.client,
                interaction.guildId,
                updatedGiveaway,
            );

            if (!saved) {
                throw new TitanBotError(
                    `Failed to save forced winner(s) for giveaway: ${messageId}`,
                    ErrorTypes.UNKNOWN,
                    'Non è stato possibile salvare il vincitore. Riprova.',
                    { messageId }
                );
            }

            logger.info(`Forced winner(s) set for giveaway ${messageId} by ${interaction.user.tag}: ${cappedWinnerIds.join(', ')}`);

            try {
                await logEvent({
                    client: interaction.client,
                    guildId: interaction.guildId,
                    eventType: EVENT_TYPES.GIVEAWAY_WINNER,
                    data: {
                        description: `Vincitore forzato impostato per il giveaway: ${giveaway.prize}`,
                        channelId: giveaway.channelId,
                        userId: interaction.user.id,
                        fields: [
                            { name: 'Premio', value: giveaway.prize || 'Sconosciuto', inline: true },
                            { name: 'Vincitore/i impostato/i', value: cappedWinnerIds.map(id => `<@${id}>`).join(', '), inline: false },
                            { name: 'Impostato da', value: `<@${interaction.user.id}>`, inline: true },
                        ]
                    }
                });
            } catch (logError) {
                logger.debug('Error logging forced winner event:', logError);
            }

            // Risposta ephemeral: solo lo staff che ha eseguito il comando la vede.
            // Il giveaway continua a girare fino allo scadere del timer: quando finisce,
            // l'annuncio dichiarerà SEMPRE apertamente che il vincitore è stato scelto dallo staff.
            return InteractionHelper.safeReply(interaction, {
                embeds: [
                    successEmbed(
                        "Vincitore✅",
                        `Vincitore/i impostato/i per **${giveaway.prize}**: ${cappedWinnerIds.map(id => `<@${id}>`).join(', ')}.\n\nIl giveaway continuerà normalmente fino alla scadenza del timer. All'annuncio finale verrà dichiarato apertamente che il vincitore è stato selezionato manualmente dallo staff.`,
                    ),
                ],
                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {
            await handleInteractionError(interaction, error, {
                type: 'command',
                commandName: 'gforcewinner',
                context: 'giveaway_force_winner'
            });
        }
    },
};
