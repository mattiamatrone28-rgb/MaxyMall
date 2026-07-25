const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    MessageFlags,
} = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');

const GIVEAWAYS_PATH = path.join(__dirname, '..', 'giveaways.json');

function loadGiveaways() {
    if (!fs.existsSync(GIVEAWAYS_PATH)) return {};
    try {
        const raw = fs.readFileSync(GIVEAWAYS_PATH, 'utf-8');
        return JSON.parse(raw || '{}');
    } catch (err) {
        console.error('[gsetwinner] Errore nel leggere giveaways.json:', err);
        return {};
    }
}

function saveGiveaways(data) {
    fs.writeFileSync(GIVEAWAYS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gsetwinner')
        .setDescription('Imposta manualmente il vincitore di un giveaway')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption(option =>
            option
                .setName('message_id')
                .setDescription("L'ID del messaggio del giveaway")
                .setRequired(true),
        )
        .addUserOption(option =>
            option
                .setName('winner')
                .setDescription('Il nuovo vincitore del giveaway')
                .setRequired(true),
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const messageId = interaction.options.getString('message_id');
        const winner = interaction.options.getUser('winner');

        const giveaways = loadGiveaways();
        const giveaway = giveaways[messageId];

        if (!giveaway) {
            return interaction.editReply(
                `❌ Nessun giveaway trovato con l'ID messaggio \`${messageId}\`.`,
            );
        }

        let channel;
        try {
            channel = await interaction.guild.channels.fetch(giveaway.channelId);
        } catch {
            return interaction.editReply(
                '❌ Non riesco a trovare il canale originale del giveaway.',
            );
        }

        let giveawayMessage;
        try {
            giveawayMessage = await channel.messages.fetch(messageId);
        } catch {
            return interaction.editReply(
                '❌ Non riesco a trovare il messaggio originale del giveaway.',
            );
        }

        giveaway.winnerId = winner.id;
        giveaway.ended = true;
        giveaways[messageId] = giveaway;
        saveGiveaways(giveaways);

        try {
            const oldEmbed = giveawayMessage.embeds[0];
            const updatedEmbed = new EmbedBuilder(oldEmbed ? oldEmbed.data : {})
                .setTitle(oldEmbed?.title ?? `🎉 ${giveaway.prize}`)
                .setDescription(
                    `Vincitore: <@${winner.id}>\n\.`,
                )
                .setColor(0x2ecc71);

            await giveawayMessage.edit({ embeds: [updatedEmbed] });
        } catch (err) {
            console.error("[gsetwinner] Impossibile modificare l'embed originale:", err);
        }

        await channel.send(
            `🎉 Il vincitore del giveaway **${giveaway.prize}** è <@${winner.id}>!`,
        );

        return interaction.editReply(
            `✅ Vincitore impostato con successo: <@${winner.id}> per il giveaway \`${messageId}\`.`,
        );
    },
};
