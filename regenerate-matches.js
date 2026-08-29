/**
 * Script to regenerate tournament matches
 * Usage: node regenerate-matches.js <tournamentId>
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function regenerateMatches(tournamentId) {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const Match = mongoose.model('Match', new mongoose.Schema({}, { strict: false, collection: 'matches' }));
    const Tournament = mongoose.model('Tournament', new mongoose.Schema({}, { strict: false, collection: 'tournaments' }));
    const BackboneUser = mongoose.model('BackboneUser', new mongoose.Schema({}, { strict: false, collection: 'backboneusers' }));

    // 1. Find the tournament
    const tournament = await Tournament.findOne({ TournamentId: tournamentId });
    if (!tournament) {
      console.error('❌ Tournament not found:', tournamentId);
      process.exit(1);
    }

    console.log('📋 Tournament found:', tournament.TournamentName);
    console.log('   Party Size:', tournament.PartySize);
    console.log('   Max Players Per Match:', tournament.MaxPlayersPerMatch);

    const phaseId = tournament.CurrentPhaseId || 1;

    // 2. Delete existing matches for current phase
    const deleteResult = await Match.deleteMany({
      tournamentid: tournamentId,
      phaseid: phaseId
    });
    console.log(`🗑️  Deleted ${deleteResult.deletedCount} existing matches`);

    // 3. Clear UserMatch from all users
    await BackboneUser.updateMany(
      { [`Tournaments.${tournamentId}`]: { $exists: true } },
      { 
        $set: { 
          [`Tournaments.${tournamentId}.UserMatch`]: null,
          [`Tournaments.${tournamentId}.UserMatches`]: []
        } 
      }
    );
    console.log('🧹 Cleared user matches');

    // 4. Trigger match regeneration by calling the generation function
    console.log('🔄 Regenerating matches...');
    console.log('⚠️  You need to restart the server for matches to be regenerated');
    console.log('   Or call the tournament endpoint to trigger generation');

    await mongoose.disconnect();
    console.log('✅ Done! Restart the server to regenerate matches.');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

const tournamentId = process.argv[2];
if (!tournamentId) {
  console.error('Usage: node regenerate-matches.js <tournamentId>');
  process.exit(1);
}

regenerateMatches(tournamentId);
