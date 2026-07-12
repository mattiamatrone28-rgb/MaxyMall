import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
    data: new SlashCommandBuilder()
        .setName('say')
        .setDescription('Fa scrivere un messaggio al bot')
        .addStringOption(option =>
            option.setName('messaggio')
                .setDescription('Il testo che il bot dovrà scrivere')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('canale')
                .setDescription('Canale in cui inviare il messaggio (default: canale attuale)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    category: 'Utility',

    async execute(interaction, config, client) {
        const deferSuccess = await InteractionHelper.safeDefer(interaction, {
            flags: MessageFlags.Ephemeral,
        });
        if (!deferSuccess) {
            logger.warn(`Say interaction defer failed`, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'say',
            });
            return;
        }

        try {
            const messaggio = interaction.options.getString('messaggio');
            const canale = interaction.options.getChannel('canale') || interaction.channel;

            const permissions = canale.permissionsFor(client.user);
            if (!permissions?.has(PermissionFlagsBits.SendMessages)) {
                throw new Error(`Non ho i permessi per scrivere in ${canale}.`);
            }

            await canale.send(messaggio);

            const embed = successEmbed(
                'Messaggio inviato',
                `Il messaggio è stato inviato in ${canale}.`,
            );

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
            logger.debug(`Say command executed by user ${interaction.user.id} in guild ${interaction.guildId}`);
        } catch (error) {
            logger.error('Say command error:', error);
            await handleInteractionError(interaction, error, {
                commandName: 'say',
                source: 'say_command',
            });
        }
    },
};
