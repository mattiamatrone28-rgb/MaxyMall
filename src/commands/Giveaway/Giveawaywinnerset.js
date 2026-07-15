const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// ⚠️ Se vuoi che SOLO tu possa usare questo comando, inserisci qui il tuo ID Discord.
// Per ottenerlo: Impostazioni utente > Avanzate > Modalità sviluppatore (ON),
// poi click destro sul tuo nome > "Copia ID utente".
const OWNER_ID = ;

module.exports = 1459234785363890340
  data: new SlashCommandBuilder()
    .setName('giveaway-vincitore')
    .setDescription('Scegli manualmente il vincitore di un giveaway')
    .addStringOption(option =>
      option
        .setName('message_id')
        .setDescription("ID del messaggio del giveaway (click destro sul messaggio > Copia ID)")
        .setRequired(true)
    )
    .addUserOption(option =>
      option
        .setName('vincitore')
        .setDescription('Utente da dichiarare vincitore')
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName('canale')
        .setDescription('Canale dove si trova il messaggio del giveaway (default: canale attuale)')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Blocco per chiunque non sia il proprietario impostato sopra.
    // Se preferisci non hardcodare l'ID, puoi rimuovere questo blocco e usare invece
    // i permessi del comando da Server Settings > Integrazioni (vedi spiegazione).
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({
        content: '❌ Non hai il permesso di usare questo comando.',
        ephemeral: true,
      });
    }

    const messageId = interaction.options.getString('message_id');
    const winner = interaction.options.getUser('vincitore');
    const channel = interaction.options.getChannel('canale') || interaction.channel;

    try {
      const giveawayMessage = await channel.messages.fetch(messageId);

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('🎉 Giveaway concluso!')
        .setDescription(`Il vincitore scelto è: ${winner}`)
        .setTimestamp();

      // Modifica il messaggio originale del giveaway per mostrare il vincitore
      await giveawayMessage.edit({
        content: `🎉 **GIVEAWAY TERMINATO** 🎉\nVincitore: ${winner}`,
        embeds: [embed],
      });

      // Annuncio nel canale, taggando il vincitore
      await channel.send({
        content: `Congratulazioni ${winner}! Hai vinto il giveaway! 🎉`,
      });

      await interaction.reply({
        content: `✅ Vincitore impostato con successo: ${winner}`,
        ephemeral: true,
      });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: '❌ Non sono riuscito a trovare o modificare quel messaggio. Controlla che il Message ID e il canale siano corretti.',
        ephemeral: true,
      });
    }
  },
};
