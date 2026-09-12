import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ComponentType,
} from "discord.js";
import { CreateTournament } from "./Database";
import { GeneratePrizepoolId } from "../Modules/Extensions";
import {
  Emotes,
  Scenes,
  TournamentPhaseType,
  Regions,
  TournamentStatus,
  TournamentSignUpStatus,
  TournamentType,
  TournamentUserStatus,
  TournamentHubMatchStatus,
  TournamentMatchStatus,
  TournamentMode,
  MapTypes,
  SceneTypes,
  OverrideTournamentMode,
} from "../Backbone/Config";
import { Tournament } from "../Models/Tournament";
import { BackboneUser } from "../Models/BackboneUser";
import { Match } from "../Models/Matches";
import { Qualify } from "../Backbone/Logic/GetMatches";
import { msg, warn } from "../Modules/Logger";

// ─── BOT CLIENT ──────────────────────────────────────────────────────────────
export const Bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const APP_ID    = process.env.BOT_APP_ID || "";
const GUILD_ID  = process.env.BOT_GUILD_ID || "";

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is not set in .env — bot will not connect.");
}

// ─── AUTHORIZED USERS ────────────────────────────────────────────────────────
const AUTHORIZED_USERS: string[] = (process.env.AUTHORIZED_USERS || "")
  .split(",")
  .map((id) => id.trim())
  .filter((id) => id.length > 0 && /^\d+$/.test(id));

// ─── SCHEDULED TOURNAMENTS ───────────────────────────────────────────────────
interface ScheduledTournamentConfig {
  scheduleId: string;
  scheduledFor: Date;
  createdBy: string;
  config: any;
  timer: ReturnType<typeof setTimeout>;
}
const scheduledTournaments = new Map<string, ScheduledTournamentConfig>();

// ─── REGION CHOICES ──────────────────────────────────────────────────────────
const regionChoices = Object.keys(Regions)
  .filter((k) => isNaN(Number(k)))
  .map((name) => ({
    name,
    value: Regions[name as keyof typeof Regions],
  }));

// ─── MAP CHOICES ─────────────────────────────────────────────────────────────
const ALL_MAP_CHOICES = Object.keys(Scenes)
  .filter((k) => isNaN(Number(k)))
  .map((mapName) => ({ name: mapName, value: mapName }));

const mapChoicesSlice1 = ALL_MAP_CHOICES.slice(0, 25);

// ─── EMOTE PRESET CHOICES ────────────────────────────────────────────────────
const EMOTE_PRESETS = [
  { name: "All Allowed",        value: "all"  },
  { name: "No Emotes",          value: "0"    },
  { name: "Punch Only",         value: "-2"   },
  { name: "Punch & Kick Only",  value: "-3"   },
  { name: "Special Emotes Only",value: "-1"   },
  { name: "Banana Only",        value: "-4"   },
  { name: "Hug Only",           value: "-5"   },
];

// ─── PHASE TYPE CHOICES ───────────────────────────────────────────────────────
const phaseTypeChoices = Object.keys(TournamentPhaseType)
  .filter((k) => isNaN(Number(k)))
  .map((name) => ({
    name: name.replace(/([A-Z])/g, " $1").trim(),
    value: TournamentPhaseType[name as keyof typeof TournamentPhaseType].toString(),
  }));

// ─── TOURNAMENT TYPE CHOICES ──────────────────────────────────────────────────
const tournamentTypeChoices = Object.keys(TournamentType)
  .filter((k) => isNaN(Number(k)))
  .map((name) => ({
    name: name.replace(/([A-Z])/g, " $1").trim(),
    value: TournamentType[name as keyof typeof TournamentType].toString(),
  }));

// ─── TOURNAMENT MODES ────────────────────────────────────────────────────────
const TOURNAMENT_MODES = [
  { label: "1v1 - 4 slots - 2 rounds",   partySize: 1, maxInvites: 4,  rounds: 2 },
  { label: "1v1 - 8 slots - 3 rounds",   partySize: 1, maxInvites: 8,  rounds: 3 },
  { label: "1v1 - 16 slots - 4 rounds",  partySize: 1, maxInvites: 16, rounds: 4 },
  { label: "1v1 - 32 slots - 5 rounds",  partySize: 1, maxInvites: 32, rounds: 5 },
  { label: "1v1 - 64 slots - 6 rounds",  partySize: 1, maxInvites: 64, rounds: 6 },
  { label: "2v2 - 4 slots - 1 round",    partySize: 2, maxInvites: 4,  rounds: 1 },
  { label: "2v2 - 8 slots - 2 rounds",   partySize: 2, maxInvites: 8,  rounds: 2 },
  { label: "2v2 - 16 slots - 3 rounds",  partySize: 2, maxInvites: 16, rounds: 3 },
  { label: "2v2 - 32 slots - 4 rounds",  partySize: 2, maxInvites: 32, rounds: 4 },
  { label: "2v2 - 64 slots - 5 rounds",  partySize: 2, maxInvites: 64, rounds: 5 },
  { label: "3v3 - 6 slots - 1 round",    partySize: 3, maxInvites: 6,  rounds: 1 },
  { label: "3v3 - 12 slots - 2 rounds",  partySize: 3, maxInvites: 12, rounds: 2 },
  { label: "3v3 - 24 slots - 3 rounds",  partySize: 3, maxInvites: 24, rounds: 3 },
  { label: "3v3 - 48 slots - 4 rounds",  partySize: 3, maxInvites: 48, rounds: 4 },
  { label: "4v4 - 8 slots - 1 round",    partySize: 4, maxInvites: 8,  rounds: 1 },
  { label: "4v4 - 16 slots - 2 rounds",  partySize: 4, maxInvites: 16, rounds: 2 },
  { label: "4v4 - 32 slots - 3 rounds",  partySize: 4, maxInvites: 32, rounds: 3 },
  { label: "4v4 - 64 slots - 4 rounds",  partySize: 4, maxInvites: 64, rounds: 4 },
];

// ─── STATUS LABELS ───────────────────────────────────────────────────────────
const STATUS_LABELS: Record<number, string> = {
  [-1]: "❓ Unknown",
  0:    "⏳ Not Started",
  1:    "🟢 Sign-ups Open",
  2:    "🔒 Sign-ups Closed",
  3:    "🏁 Finished",
  4:    "❌ Cancelled",
  5:    "▶️ In Progress",
};

const MATCH_STATUS_LABELS: Record<number, string> = {
  [-1]: "Unknown",
  0:    "Created",
  1:    "Waiting for Opponent",
  2:    "Ready",
  3:    "In Progress",
  4:    "Finished",
  5:    "Closed",
  8:    "Closed",
};

// ─── REST CLIENT ─────────────────────────────────────────────────────────────
const Rest = new REST({ version: "10" }).setToken(BOT_TOKEN);

// ════════════════════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

function parseEmotes(emotesInput: string): number[] {
  return emotesInput
    .split(",")
    .map((e) => {
      const trimmed = e.trim();
      const emoteId = Emotes[trimmed as keyof typeof Emotes];
      if (emoteId !== undefined) return emoteId as number;
      const lowerTrimmed = trimmed.toLowerCase();
      const matchKey = Object.keys(Emotes).find(
        (k) => isNaN(Number(k)) && k.toLowerCase().includes(lowerTrimmed)
      );
      if (matchKey) return Emotes[matchKey as keyof typeof Emotes] as number;
      const parsed = parseInt(trimmed);
      return isNaN(parsed) ? null : parsed;
    })
    .filter((id): id is number => id !== null);
}

function parsePrizes(prizesInput: string): Array<{ position: number; amount: number }> {
  return prizesInput
    .split(",")
    .map((p) => {
      const parts = p.trim().split(":");
      if (parts.length === 2) {
        const position = parseInt(parts[0]);
        const amount   = parseInt(parts[1]);
        if (!isNaN(position) && !isNaN(amount)) return { position, amount };
      }
      return null;
    })
    .filter((prize): prize is { position: number; amount: number } => prize !== null);
}

function getEmoteDisplayName(id: number): string {
  const PRESET_NAMES: Record<number, string> = {
    0:   "No Emotes",
    [-1]:"Special Emotes Only",
    [-2]:"Punch Only",
    [-3]:"Punch & Kick Only",
    [-4]:"Banana Only",
    [-5]:"Hug Only",
  };
  if (id in PRESET_NAMES) return PRESET_NAMES[id];
  const name = Object.keys(Emotes).find(
    (k) => isNaN(Number(k)) && (Emotes[k as keyof typeof Emotes] as number) === id
  );
  return name ? name : `ID:${id}`;
}

function getEmoteNames(emoteIds: number[]): string {
  if (!emoteIds || emoteIds.length === 0) return "All Allowed";
  return emoteIds.map(getEmoteDisplayName).join(", ");
}

function getModeLabel(partySize: number): string {
  const modeMap: Record<number, string> = { 1: "1v1", 2: "2v2", 3: "3v3", 4: "4v4" };
  return modeMap[partySize] || `${partySize}v${partySize}`;
}

function getMapType(sceneName: string): string {
  const sceneValue = Scenes[sceneName as keyof typeof Scenes];
  if (!sceneValue) return "Unknown";
  return SceneTypes[sceneValue as keyof typeof SceneTypes] || "Unknown";
}

function getMapTypeEmoji(type: string): string {
  const emojis: Record<string, string> = {
    Race: "🏃", Elimination: "💀", Shooter: "🔫", Driving: "🚗",
    Collect: "🪙", Race_Survive: "☠️🏃", Team: "👥",
  };
  return emojis[type] || "🗺️";
}

function mapFriendlyName(sceneId: string): string {
  const name = Object.keys(Scenes).find((k) => Scenes[k as keyof typeof Scenes] === sceneId);
  return name || sceneId;
}

function getMapFriendlyName(sceneId: string): string {
  return mapFriendlyName(sceneId);
}

function safeColor(hex: string): number {
  try {
    return parseInt(hex.replace(/^#/, "").substring(0, 6), 16) || 0x5865f2;
  } catch {
    return 0x5865f2;
  }
}

function modeText(tour: any): string {
  if (tour.PartySize === 1 && tour.MaxPlayersPerMatch > 2) {
    return Array(tour.MaxPlayersPerMatch).fill("1").join("v");
  }
  return `${tour.PartySize}v${tour.PartySize}`;
}

function calculateTournamentStatus(tournament: any): number {
  const now    = new Date();
  const opens  = new Date(tournament.SignupStart);
  const starts = new Date(tournament.StartTime);
  const closes = new Date(starts.getTime() - 75 * 1000);

  if (
    tournament.Status === TournamentStatus.Canceled ||
    tournament.Status === TournamentStatus.Finished
  ) return tournament.Status;

  if (now < opens)   return TournamentStatus.NotStarted;
  if (now <= closes) return TournamentStatus.InvitationOpen;
  if (now < starts)  return TournamentStatus.InvitationClose;
  return TournamentStatus.Running;
}

function phaseTypeName(t: number | string): string {
  const n = Number(t);
  const map: Record<number, string> = {
    [TournamentPhaseType.Arena]:                    "🏟️ Arena",
    [TournamentPhaseType.SingleEliminationBracket]: "🏆 Single Elimination",
    [TournamentPhaseType.RoundRobin]:               "🔄 Round Robin",
    [TournamentPhaseType.DoubleEliminationBracket]: "⚔️ Double Elimination",
    [TournamentPhaseType.DynamicBrackets]:          "🔀 Dynamic Brackets",
  };
  return map[n] ?? `Phase ${t}`;
}

function bestBracketSize(n: number): { size: number; rounds: number } {
  if (n <= 1) return { size: 1, rounds: 0 };
  let x = 1;
  while ((1 << x) < n) x++;
  const powerOfX        = 1 << x;
  const powerOfXMinus1  = 1 << (x - 1);
  if (powerOfX > n + powerOfXMinus1) {
    return { size: powerOfXMinus1, rounds: x - 1 };
  }
  return { size: powerOfX, rounds: x };
}

function parseScheduleDate(input: string): Date | null {
  const cleaned = input.trim().replace(" ", ",");
  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s](\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (isNaN(date.getTime())) return null;
  return date;
}

async function getPlayerCount(tournamentId: string): Promise<number> {
  return BackboneUser.countDocuments({
    [`Tournaments.${tournamentId}`]: { $exists: true },
    [`Tournaments.${tournamentId}.SignedUp`]: true,
  });
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

function buildTeamDisplay(users: any[]): string {
  if (!users || users.length === 0) return "*No players*";
  const teams = new Map<string, any[]>();
  for (const u of users) {
    const tid = String(u["@team-id"]);
    if (!teams.has(tid)) teams.set(tid, []);
    teams.get(tid)!.push(u);
  }
  const lines: string[] = [];
  let teamNum = 1;
  for (const [teamId, members] of teams.entries()) {
    const playerList  = members.map((m) => `\`${String(m["@user-id"])}\``).join(", ");
    const score       = members[0]["@team-score"];
    const isWinner    = members[0]["@match-winner"] === "1";
    const winnerTag   = isWinner ? " 🏆" : "";
    const scoreStr    = score !== undefined && score !== "0" ? ` — Score: **${score}**` : "";
    lines.push(`**Team ${teamNum}${winnerTag}**: ${playerList}${scoreStr}`);
    teamNum++;
  }
  return lines.join("\n");
}

// ─── BUILD TOURNAMENT EMBED ───────────────────────────────────────────────────
function buildTournamentEmbed(t: any, calculatedStatus?: number): EmbedBuilder {
  const status      = calculatedStatus ?? calculateTournamentStatus(t);
  const colorValue  = parseInt((t.TournamentColor || "#2ad100").replace("#", ""), 16);
  const statusLabel = STATUS_LABELS[status] || "Unknown";

  const mapName = Object.keys(Scenes).find(
    (k) => isNaN(Number(k)) && Scenes[k as keyof typeof Scenes] === (t.Phases?.[0]?.Maps?.[0] || "")
  ) || String(t.Phases?.[0]?.Maps?.[0] || "N/A");
  const mapType  = mapName !== "N/A" ? getMapType(mapName) : "N/A";
  const mapEmoji = getMapTypeEmoji(mapType);

  const rawEmotes = t.Properties?.DisabledEmotes;
  const disabledEmotes: number[] = Array.isArray(rawEmotes)
    ? rawEmotes.map((e: any) => Number(e)).filter((e: number) => !isNaN(e))
    : [];
  const disabledEmotesText = getEmoteNames(disabledEmotes);

  const prizes     = Array.isArray(t.Prizes) ? t.Prizes : [];
  const prizesText = prizes.length > 0
    ? prizes
        .sort((a: any, b: any) => a.position - b.position)
        .map((p: any) => {
          const medal = p.position === 1 ? "🥇" : p.position === 2 ? "🥈" : p.position === 3 ? "🥉" : `**#${p.position}**`;
          return `${medal} › **${Number(p.amount).toLocaleString()} 💎**`;
        })
        .join("\n")
    : "No prizes defined";

  const tournamentTypeName = Object.keys(TournamentType).find(
    (k) => isNaN(Number(k)) && TournamentType[k as keyof typeof TournamentType] === t.TournamentType
  ) || "Generic";

  const phaseType = t.Phases?.[0]?.PhaseType !== undefined
    ? Object.keys(TournamentPhaseType).find(
        (k) =>
          isNaN(Number(k)) &&
          TournamentPhaseType[k as keyof typeof TournamentPhaseType] === t.Phases[0].PhaseType
      ) || "N/A"
    : "N/A";

  const safeStr = (v: any, fallback = "N/A"): string => {
    if (v === null || v === undefined) return fallback;
    if (typeof v === "object") return fallback;
    return String(v) || fallback;
  };

  const signupTs = Math.floor(new Date(t.SignupStart).getTime() / 1000);
  const startTs  = Math.floor(new Date(t.StartTime).getTime() / 1000);
  const signupStr = isNaN(signupTs) ? "N/A" : `<t:${signupTs}:F> (<t:${signupTs}:R>)`;
  const startStr  = isNaN(startTs)  ? "N/A" : `<t:${startTs}:F> (<t:${startTs}:R>)`;

  const embed = new EmbedBuilder()
    .setColor(isNaN(colorValue) ? 0x2ad100 : colorValue)
    .setTitle(safeStr(t.TournamentName, "Tournament"))
    .setDescription(`\`${safeStr(t.TournamentId)}\``)
    .addFields(
      { name: "Status",   value: statusLabel,                                      inline: true },
      { name: "Mode",     value: getModeLabel(Number(t.PartySize) || 1),            inline: true },
      { name: "Type",     value: tournamentTypeName,                                inline: true },
      { name: "Players",  value: `${safeStr(t.CurrentInvites, "0")}/${safeStr(t.MaxInvites, "0")}`, inline: true },
      { name: "Region",   value: safeStr(t.Region?.toUpperCase?.() ?? t.Region),   inline: true },
      { name: "Rounds",   value: safeStr(t.RoundCount),                            inline: true },
      { name: "Map",      value: `${mapName} *(${mapType})*`,                      inline: true },
      { name: "Bracket",  value: phaseType,                                         inline: true },
      { name: "Fee",      value: safeStr(t.EntryFee, "0"),                         inline: true },
      { name: "Emotes",   value: disabledEmotesText,                               inline: false },
      { name: "Prizes",   value: prizesText,                                        inline: false },
      { name: "Sign-ups", value: signupStr,                                         inline: false },
      { name: "Start",    value: startStr,                                          inline: false },
    )
    .setTimestamp();

  if (t.TournamentImage && typeof t.TournamentImage === "string") embed.setThumbnail(t.TournamentImage);
  if (t.Properties?.StreamURL && typeof t.Properties.StreamURL === "string") {
    embed.addFields({ name: "Stream", value: t.Properties.StreamURL, inline: false });
  }
  if (t.Properties?.IsInvitationOnly) {
    embed.addFields({ name: "Access", value: "Invite only", inline: true });
  }
  return embed;
}

// ─── DETAILED TOUR EMBED ─────────────────────────────────────────────────────
async function buildDetailedTourEmbed(tour: any): Promise<EmbedBuilder> {
  const ts          = Math.floor(new Date(tour.StartTime).getTime() / 1000);
  const opens       = Math.floor(new Date(tour.SignupStart).getTime() / 1000);
  const realPlayers = await getPlayerCount(tour.TournamentId.toString());

  const embed = new EmbedBuilder()
    .setTitle(`${tour.TournamentName}`)
    .setColor(safeColor(tour.TournamentColor || "#5865f2"))
    .addFields(
      { name: "🆔 ID",        value: `\`${tour.TournamentId}\``,            inline: true  },
      { name: "📊 Status",    value: STATUS_LABELS[tour.Status] || "?",     inline: true  },
      { name: "🌍 Region",    value: tour.Region?.toUpperCase() || "?",     inline: true  },
      { name: "👥 Players",   value: `${realPlayers} / ${tour.MaxInvites}`, inline: true  },
      { name: "🎮 Mode",      value: getModeLabel(tour.PartySize || 1),     inline: true  },
      { name: "💰 Entry Fee", value: tour.EntryFee > 0 ? `${tour.EntryFee} 💎` : "Free", inline: true },
      { name: "📅 Opens",     value: `<t:${opens}:R>`,                      inline: true  },
      { name: "🚀 Starts",    value: `<t:${ts}:F> (<t:${ts}:R>)`,          inline: false },
    )
    .setTimestamp();

  if (tour.TournamentImage) embed.setThumbnail(tour.TournamentImage);

  const phaseLines = (tour.Phases || []).map((p: any, i: number) => {
    const maps = (p.Maps || []).map(mapFriendlyName).join(", ") || "Default";
    return `**Phase ${i + 1}** — ${phaseTypeName(p.PhaseType)}\nRounds: ${p.RoundCount} | Max Teams: ${p.MaxTeams || "∞"} | Maps: ${maps}`;
  });
  if (phaseLines.length > 0) {
    const phasesValue = phaseLines.join("\n\n");
    embed.addFields({
      name:   "📋 Phases",
      value:  phasesValue.length > 1020 ? phasesValue.slice(0, 1017) + "…" : phasesValue,
      inline: false,
    });
  }

  const disabledEmotes = tour.Properties?.DisabledEmotes || [];
  embed.addFields({ name: "🚫 Disabled Emotes", value: getEmoteNames(disabledEmotes), inline: false });

  const prizes = Array.isArray(tour.Prizes) ? tour.Prizes : [];
  if (prizes.length > 0) {
    embed.addFields({
      name:   "🏆 Prizes",
      value:  prizes
        .sort((a: any, b: any) => a.position - b.position)
        .map((p: any) => {
          const medal = p.position === 1 ? "🥇" : p.position === 2 ? "🥈" : p.position === 3 ? "🥉" : `**#${p.position}**`;
          return `${medal} › **${Number(p.amount).toLocaleString()} 💎**`;
        })
        .join("\n"),
      inline: false,
    });
  }

  if (tour.Properties?.StreamURL) {
    embed.addFields({ name: "📺 Stream", value: tour.Properties.StreamURL, inline: false });
  }
  if (tour.Properties?.IsInvitationOnly) {
    embed.addFields({ name: "🔐 Access", value: "Invite Only", inline: true });
  }
  return embed;
}

// ════════════════════════════════════════════════════════════════════════════
//  SLASH COMMANDS DEFINITION
// ════════════════════════════════════════════════════════════════════════════

Bot.on("ready", async () => {
  console.log(`✅ Bot connected as ${Bot.user?.tag}`);

  const modeChoices = TOURNAMENT_MODES.slice(0, 25).map((mode, index) => ({
    name:  mode.label,
    value: index,
  }));

  const commands = [

    // ── /create-tournament ────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("create-tournament")
      .setDescription("🏆 Create a new tournament (full options)")
      .addStringOption((opt) =>
        opt.setName("name").setDescription("Tournament name").setRequired(true)
      )
      .addIntegerOption((opt) =>
        opt.setName("mode").setDescription("Tournament mode (partySize x rounds x slots)")
          .setRequired(true).addChoices(...modeChoices)
      )
      .addStringOption((opt) =>
        opt.setName("region").setDescription("Server region")
          .setRequired(true).addChoices(...regionChoices)
      )
      .addStringOption((opt) =>
        opt.setName("map").setDescription("Map for Round 1").setRequired(true).setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt.setName("map2").setDescription("Map for Round 2 (optional)").setRequired(false).setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt.setName("map3").setDescription("Map for Round 3 (optional)").setRequired(false).setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt.setName("map4").setDescription("Map for Round 4 (optional)").setRequired(false).setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt.setName("map5").setDescription("Map for Round 5 (optional)").setRequired(false).setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt.setName("map6").setDescription("Map for Round 6 (optional)").setRequired(false).setAutocomplete(true)
      )
      .addIntegerOption((opt) =>
        opt.setName("start").setDescription("Starts in X minutes").setRequired(true)
      )
      .addStringOption((opt) =>
        opt.setName("type").setDescription("Tournament type")
          .setRequired(false).addChoices(...tournamentTypeChoices.slice(0, 4))
      )
      .addStringOption((opt) =>
        opt.setName("phase").setDescription("Phase/bracket type")
          .setRequired(false).addChoices(...phaseTypeChoices.slice(0, 5))
      )
      .addIntegerOption((opt) =>
        opt.setName("signup").setDescription("Sign-ups open in X minutes").setRequired(false)
      )
      .addIntegerOption((opt) =>
        opt.setName("fee").setDescription("Entry fee (diamonds)").setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName("restrictions").setDescription("Emote restriction preset")
          .setRequired(false).addChoices(...EMOTE_PRESETS)
      )
      .addStringOption((opt) =>
        opt.setName("disabledemotes").setDescription("Disabled emotes by name or ID (comma-separated)").setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName("image").setDescription("Tournament image/thumbnail URL").setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName("color").setDescription("Embed color in hexadecimal (e.g. #FF5500)").setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName("stream").setDescription("Stream/broadcast URL").setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName("invited").setDescription("Invited user IDs (comma-separated) — private tournament").setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName("prizes").setDescription("Prizes by position (format: 1:1000,2:500,3:250)").setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName("admins").setDescription("Additional admin IDs (comma-separated)").setRequired(false)
      )
      .addStringOption((opt) =>
        opt.setName("schedule").setDescription("Schedule date/time (DD/MM/YYYY,HH:MM)").setRequired(false)
      )
      .toJSON(),

    // ── /list ─────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("list")
      .setDescription("📋 List tournaments with filters & pagination")
      .addStringOption((o) =>
        o.setName("region").setDescription("Filter by region").setRequired(false).addChoices(...regionChoices)
      )
      .addIntegerOption((o) =>
        o.setName("status").setDescription("Filter by status").setRequired(false).addChoices(
          { name: "⏳ Not Started", value: 0 },
          { name: "🟢 Open",        value: 1 },
          { name: "🔒 Closed",      value: 2 },
          { name: "🏁 Finished",    value: 3 },
          { name: "❌ Canceled",    value: 4 },
          { name: "▶️ Running",     value: 5 },
        )
      )
      .addStringOption((o) =>
        o.setName("search").setDescription("Search by name").setRequired(false)
      )
      .toJSON(),

    // ── /info ─────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("info")
      .setDescription("🔍 Detailed info about a tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .toJSON(),

    // ── /players ──────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("players")
      .setDescription("👥 List players signed up in a tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .addIntegerOption((o) => o.setName("page").setDescription("Page number").setRequired(false).setMinValue(1))
      .toJSON(),

    // ── /matches ──────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("matches")
      .setDescription("⚔️ View matches in a tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID (leave empty for all active)").setRequired(false))
      .addIntegerOption((o) => o.setName("phase").setDescription("Phase number").setRequired(false).setMinValue(1))
      .addIntegerOption((o) => o.setName("round").setDescription("Round number").setRequired(false).setMinValue(1))
      .toJSON(),

    // ── /edit ─────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("edit")
      .setDescription("✏️ Edit an existing tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .addStringOption((o) => o.setName("name").setDescription("New name").setRequired(false))
      .addIntegerOption((o) => o.setName("max").setDescription("New max players").setRequired(false).setMinValue(2))
      .addIntegerOption((o) => o.setName("fee").setDescription("New entry fee").setRequired(false).setMinValue(0))
      .addStringOption((o) => o.setName("image").setDescription("New image URL").setRequired(false))
      .addStringOption((o) => o.setName("color").setDescription("New color hex").setRequired(false))
      .addStringOption((o) => o.setName("stream").setDescription("New stream URL").setRequired(false))
      .addIntegerOption((o) =>
        o.setName("start").setDescription("New start time in X minutes from now").setRequired(false).setMinValue(1)
      )
      .addIntegerOption((o) =>
        o.setName("signup").setDescription("New sign-up open time in X minutes from now").setRequired(false).setMinValue(0)
      )
      .addStringOption((o) =>
        o.setName("disabledemotes").setDescription("Disabled emotes. Use 'reset' to allow all.").setRequired(false)
      )
      .addStringOption((o) =>
        o.setName("prizes").setDescription("Prizes (e.g. 1:1000,2:500). Use 'none' to clear.").setRequired(false)
      )
      .addStringOption((o) =>
        o.setName("status").setDescription("Force status change").setRequired(false).addChoices(
          { name: "❌ Cancel Tournament", value: "cancel" },
          { name: "🏁 Mark as Finished",  value: "finish" },
        )
      )
      .toJSON(),

    // ── /cancel ───────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("cancel")
      .setDescription("❌ Cancel a tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .toJSON(),

    // ── /delete ───────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("delete")
      .setDescription("🗑️ Permanently delete a tournament and all its data")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .toJSON(),

    // ── /stats ────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("stats")
      .setDescription("📊 Show server-wide tournament statistics")
      .toJSON(),

    // ── /winners ──────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("winners")
      .setDescription("🏆 Show winners of a tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .toJSON(),

    // ── /autowin ──────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("autowin")
      .setDescription("🏅 Grant a player an automatic win in a tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .addStringOption((o) => o.setName("player").setDescription("Player username or user ID").setRequired(true))
      .toJSON(),

    // ── /kick ─────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("👢 Kick a player from a tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .addStringOption((o) => o.setName("player").setDescription("Player username or user ID").setRequired(true))
      .toJSON(),

    // ── /addplayer ────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("addplayer")
      .setDescription("➕ Force-add a player to a tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .addStringOption((o) => o.setName("player").setDescription("Player username or user ID").setRequired(true))
      .toJSON(),

    // ── /playerinfo ───────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("playerinfo")
      .setDescription("👤 Show a player's tournament history and stats")
      .addStringOption((o) => o.setName("player").setDescription("Player username or user ID").setRequired(true))
      .toJSON(),

    // ── /schedule-list ────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("schedule-list")
      .setDescription("📅 List all pending scheduled tournaments")
      .toJSON(),

    // ── /announce ─────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("announce")
      .setDescription("📢 Re-send the webhook announcement for a tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .toJSON(),

    // ── /duplicate ────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("duplicate")
      .setDescription("📋 Duplicate an existing tournament with a new start time")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID to duplicate").setRequired(true))
      .addIntegerOption((o) => o.setName("start").setDescription("New start time in X minutes").setRequired(true).setMinValue(1))
      .addIntegerOption((o) => o.setName("signup").setDescription("Sign-ups open in X minutes").setRequired(false).setMinValue(0))
      .addStringOption((o) => o.setName("name").setDescription("New name (optional, keeps original if empty)").setRequired(false))
      .toJSON(),

    // ── /setprizes ────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("setprizes")
      .setDescription("🏆 Set or update prizes for a tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .addStringOption((o) =>
        o.setName("prizes")
          .setDescription("Prizes format: 1:1000,2:500,3:250 (position:diamonds). Use 'clear' to remove all.")
          .setRequired(true)
      )
      .toJSON(),

    // ── /top ──────────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("top")
      .setDescription("🏅 Show top players leaderboard")
      .addIntegerOption((o) =>
        o.setName("limit").setDescription("Number of players to show (default: 10, max: 25)").setRequired(false).setMinValue(1).setMaxValue(25)
      )
      .toJSON(),

    // ── /resetplayer ──────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("resetplayer")
      .setDescription("🔄 Reset a player's data in a specific tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .addStringOption((o) => o.setName("player").setDescription("Player username or user ID").setRequired(true))
      .toJSON(),

    // ── /extend ───────────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("extend")
      .setDescription("⏰ Extend the start time of a tournament")
      .addStringOption((o) => o.setName("id").setDescription("Tournament ID").setRequired(true))
      .addIntegerOption((o) =>
        o.setName("minutes").setDescription("Extend by X minutes").setRequired(true).setMinValue(1).setMaxValue(1440)
      )
      .toJSON(),

    // ── /leaderboard ──────────────────────────────────────────────────────
    new SlashCommandBuilder()
      .setName("leaderboard")
      .setDescription("🌟 Send the all-time leaderboard to the webhook channel now")
      .toJSON(),

  ];

  try {
    console.log("📡 Registering slash commands...");
    if (GUILD_ID) {
      await Rest.put(Routes.applicationGuildCommands(Bot.user?.id || APP_ID, GUILD_ID), { body: commands });
    } else {
      await Rest.put(Routes.applicationCommands(Bot.user?.id || APP_ID), { body: commands });
    }
    console.log("✅ Commands registered!");
  } catch (error) {
    console.error("❌ Error registering commands:", error);
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  INTERACTION ROUTER
// ════════════════════════════════════════════════════════════════════════════

// AUTOCOMPLETE MAPS
Bot.on("interactionCreate", async (interaction) => {
  if (!interaction.isAutocomplete()) return;

  if (interaction.commandName === "create-tournament") {
    const focused = interaction.options.getFocused().toLowerCase();

    const filtered = ALL_MAP_CHOICES
      .filter(choice =>
        choice.name.toLowerCase().includes(focused)
      )
      .slice(0, 25);

    await interaction.respond(filtered);
  }
});

Bot.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand())  await handleSlashCommand(interaction);
    else if (interaction.isButton())       await handleButton(interaction);
    else if (interaction.isModalSubmit())  await handleModal(interaction);
    else if (interaction.isStringSelectMenu()) await handleSelectMenu(interaction);
  } catch (error) {
    console.error("❌ Interaction handler error:", error);
  }
});

// ─── AUTH CHECK ───────────────────────────────────────────────────────────────
async function handleSlashCommand(interaction: ChatInputCommandInteraction) {
  if (!AUTHORIZED_USERS.includes(interaction.user.id)) {
    await interaction.reply({ content: "❌ You don't have permission to use this bot.", ephemeral: true });
    return;
  }

  switch (interaction.commandName) {
    case "create-tournament": await createTournamentCommand(interaction); break;
    case "list":              await listTournaments(interaction);          break;
    case "info":              await infoTournament(interaction);           break;
    case "players":           await playersCommand(interaction);           break;
    case "matches":           await listMatches(interaction);              break;
    case "edit":              await editTournamentCommand(interaction);    break;
    case "cancel":            await cancelTournamentCommand(interaction);  break;
    case "delete":            await deleteTournamentCommand(interaction);  break;
    case "stats":             await statsCommand(interaction);             break;
    case "winners":           await winnersCommand(interaction);           break;
    case "autowin":           await autowinCommand(interaction);           break;
    case "kick":              await kickCommand(interaction);              break;
    case "addplayer":         await addPlayerCommand(interaction);         break;
    case "playerinfo":        await playerInfoCommand(interaction);        break;
    case "schedule-list":     await scheduleListCommand(interaction);      break;
    case "announce":          await announceCommand(interaction);          break;
    case "duplicate":         await duplicateCommand(interaction);         break;
    case "setprizes":         await setPrizesCommand(interaction);         break;
    case "top":               await topCommand(interaction);               break;
    case "resetplayer":       await resetPlayerCommand(interaction);       break;
    case "extend":            await extendCommand(interaction);            break;
    case "leaderboard":       await leaderboardCommand(interaction);       break;
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /create-tournament
// ════════════════════════════════════════════════════════════════════════════

async function createTournamentCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const name                = interaction.options.getString("name", true);
    const modeIndex           = interaction.options.getInteger("mode", true);
    const region              = interaction.options.getString("region", true);
    const map1                = interaction.options.getString("map", true);
    const map2                = interaction.options.getString("map2");
    const map3                = interaction.options.getString("map3");
    const map4                = interaction.options.getString("map4");
    const map5                = interaction.options.getString("map5");
    const map6                = interaction.options.getString("map6");
    const startMinutes        = interaction.options.getInteger("start", true);
    const signupMinutes       = interaction.options.getInteger("signup") ?? 0;
    const entryFee            = interaction.options.getInteger("fee") ?? 0;
    const emotePreset         = interaction.options.getString("restrictions");
    const disabledEmotesInput = interaction.options.getString("disabledemotes");
    const image               = interaction.options.getString("image") || "";
    const color               = interaction.options.getString("color") || "#2ad100";
    const streamURL           = interaction.options.getString("stream") || "";
    const invitedIdsInput     = interaction.options.getString("invited") || "";
    const prizesInput         = interaction.options.getString("prizes");
    const adminsInput         = interaction.options.getString("admins") || "";
    const tipoStr             = interaction.options.getString("type");
    const faseStr             = interaction.options.getString("phase");
    const agendarStr          = interaction.options.getString("schedule");

    const mode = TOURNAMENT_MODES[modeIndex];
    const { partySize, maxInvites, rounds } = mode;

    // Emotes
    let disabledEmotes: number[] = [];
    if (emotePreset && emotePreset !== "all") {
      disabledEmotes = [parseInt(emotePreset)];
    } else if (disabledEmotesInput) {
      disabledEmotes = parseEmotes(disabledEmotesInput);
    }

    const invitedIds  = invitedIdsInput ? invitedIdsInput.split(",").map((id) => id.trim()).filter(Boolean) : [];
    const extraAdmins = adminsInput     ? adminsInput.split(",").map((id) => id.trim()).filter(Boolean)     : [];
    const prizes      = prizesInput ? parsePrizes(prizesInput) : undefined;

    const tournamentType = tipoStr !== null ? parseInt(tipoStr) : TournamentType.GenericTournament;
    const phaseType      = faseStr !== null ? parseInt(faseStr) : TournamentPhaseType.SingleEliminationBracket;

    // ─── Build maps array ───────────────────────────────────────────────────
    const selectedMaps = [map1, map2, map3, map4, map5, map6].filter(Boolean) as string[];
    const mapValues: string[] = [];

    for (const mapName of selectedMaps) {
      const val = Scenes[mapName as keyof typeof Scenes];
      if (!val) {
        await interaction.editReply({ content: `❌ Invalid map: **${mapName}**` });
        return;
      }
      mapValues.push(val);
    }

    // Fill remaining rounds with the last selected map
    while (mapValues.length < rounds) {
      mapValues.push(mapValues[mapValues.length - 1]);
    }

    // Cut if more maps than rounds
    if (mapValues.length > rounds) {
      mapValues.length = rounds;
    }

    const colorHex   = color.startsWith("#") ? color : `#${color}`;
    const colorValue = parseInt(colorHex.replace("#", ""), 16);
    if (isNaN(colorValue)) {
      await interaction.editReply({ content: `❌ Invalid color: **${color}**` });
      return;
    }

    // ── Scheduled? ────────────────────────────────────────────────────────
    if (agendarStr) {
      const scheduledFor = parseScheduleDate(agendarStr);
      if (!scheduledFor) {
        await interaction.editReply({ content: `❌ Invalid format: \`${agendarStr}\`\nUse: **DD/MM/YYYY,HH:MM**` });
        return;
      }
      const msUntil = scheduledFor.getTime() - Date.now();
      if (msUntil <= 0) {
        await interaction.editReply({ content: "❌ This date has already passed!" });
        return;
      }
      if (msUntil > 30 * 24 * 60 * 60 * 1000) {
        await interaction.editReply({ content: "❌ Maximum 30 days in advance." });
        return;
      }

      const scheduleId = `sch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const cfg = {
        name, region, mapValues, startMinutes, signupMinutes, entryFee,
        disabledEmotes, image, colorHex, streamURL, invitedIds, extraAdmins, prizes,
        tournamentType, phaseType, partySize, maxInvites, rounds, createdBy: interaction.user.id,
      };

      const timer = setTimeout(async () => {
        try {
          const now2          = new Date();
          const startTime2    = new Date(now2.getTime() + cfg.startMinutes * 60 * 1000);
          const signupStart2  = new Date(now2.getTime() + cfg.signupMinutes * 60 * 1000);
          const tournamentId2 = now2.getTime().toString();

          await CreateTournament({
            CurrentInvites: 0,
            MaxInvites: cfg.maxInvites,
            TournamentId: tournamentId2,
            TournamentName: cfg.name,
            TournamentImage: cfg.image,
            TournamentColor: cfg.colorHex,
            StartTime: startTime2,
            SignupStart: signupStart2,
            EntryFee: cfg.entryFee,
            PrizepoolId: GeneratePrizepoolId().toString(),
            PartySize: cfg.partySize,
            Status: TournamentStatus.NotStarted,
            TournamentType: cfg.tournamentType,
            Phases: [{
              PhaseType: cfg.phaseType,
              IsPhase: false,
              RoundCount: cfg.rounds,
              MaxTeams: Math.floor(cfg.maxInvites / cfg.partySize),
              Maps: cfg.mapValues
            }],
            Region: cfg.region,
            RoundCount: cfg.rounds,
            CurrentPhaseId: 0,
            Properties: {
              IsInvitationOnly: cfg.invitedIds.length > 0,
              InvitedIds: cfg.invitedIds,
              DisabledEmotes: cfg.disabledEmotes,
              AdminIds: [cfg.createdBy, ...cfg.extraAdmins],
              StreamURL: cfg.streamURL,
            },
            MinPlayersPerMatch: 1,
            MaxPlayersPerMatch: cfg.partySize * 2,
            Prizes: cfg.prizes,
          });

          scheduledTournaments.delete(scheduleId);
          console.log(`✅ Scheduled tournament "${cfg.name}" created!`);
        } catch (err) {
          console.error(`❌ Error creating scheduled tournament ${scheduleId}:`, err);
        }
      }, msUntil);

      scheduledTournaments.set(scheduleId, {
        scheduleId,
        scheduledFor,
        createdBy: interaction.user.id,
        config: cfg,
        timer,
      });

      const schedTs = Math.floor(scheduledFor.getTime() / 1000);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(colorValue)
            .setTitle("📅 Tournament Scheduled!")
            .setDescription(`**${name}** will be created at:`)
            .addFields(
              { name: "🕐 Creation", value: `<t:${schedTs}:F> (<t:${schedTs}:R>)`, inline: false },
              { name: "🆔 Schedule ID", value: `\`${scheduleId}\``, inline: true },
              { name: "🌍 Region", value: region.toUpperCase(), inline: true },
              { name: "⚔️ Mode", value: getModeLabel(partySize), inline: true },
              {
                name: "🗺️ Maps",
                value: mapValues.map((m, i) => `R${i + 1}: **${getMapFriendlyName(m)}**`).join("\n"),
                inline: false,
              },
              { name: "🔢 Slots", value: `${maxInvites}`, inline: true },
              { name: "🚀 Start", value: `${startMinutes} min after creation`, inline: true },
            )
            .setTimestamp(),
        ],
      });
      return;
    }

    // ── Immediate creation ────────────────────────────────────────────────
    const now          = new Date();
    const startTime    = new Date(now.getTime() + startMinutes * 60 * 1000);
    const signupStart  = new Date(now.getTime() + signupMinutes * 60 * 1000);
    const tournamentId = now.getTime().toString();

    await CreateTournament({
      CurrentInvites: 0,
      MaxInvites: maxInvites,
      TournamentId: tournamentId,
      TournamentName: name,
      TournamentImage: image,
      TournamentColor: colorHex,
      StartTime: startTime,
      SignupStart: signupStart,
      EntryFee: entryFee,
      PrizepoolId: GeneratePrizepoolId().toString(),
      PartySize: partySize,
      Status: TournamentStatus.NotStarted,
      TournamentType: tournamentType,
      Phases: [{
        PhaseType: phaseType,
        IsPhase: false,
        RoundCount: rounds,
        MaxTeams: Math.floor(maxInvites / partySize),
        Maps: mapValues
      }],
      Region: region,
      RoundCount: rounds,
      CurrentPhaseId: 0,
      Properties: {
        IsInvitationOnly: invitedIds.length > 0,
        InvitedIds: invitedIds,
        DisabledEmotes: disabledEmotes,
        AdminIds: [interaction.user.id, ...extraAdmins],
        StreamURL: streamURL,
      },
      MinPlayersPerMatch: 1,
      MaxPlayersPerMatch: partySize * 2,
      Prizes: prizes,
    });

    const emotesText = getEmoteNames(disabledEmotes);
    const prizesText = prizes
      ? prizes.map((p) => `**${p.position}º** › ${p.amount.toLocaleString()} 💎`).join("\n")
      : "No prizes";

    const typeName = Object.keys(TournamentType).find(
      (k) => isNaN(Number(k)) && TournamentType[k as keyof typeof TournamentType] === tournamentType
    ) || "Generic";

    const phaseName = Object.keys(TournamentPhaseType).find(
      (k) => isNaN(Number(k)) && TournamentPhaseType[k as keyof typeof TournamentPhaseType] === phaseType
    ) || "N/A";

    const embed = new EmbedBuilder()
      .setColor(colorValue)
      .setTitle("✅ Tournament Created!")
      .setDescription(`**${name}**\n\`${tournamentId}\``)
      .addFields(
        { name: "Region", value: region.toUpperCase(), inline: true },
        { name: "Mode", value: getModeLabel(partySize), inline: true },
        { name: "Type", value: typeName, inline: true },
        { name: "Slots", value: `${maxInvites} (${rounds} rounds)`, inline: true },
        { name: "Bracket", value: phaseName, inline: true },
        { name: "Fee", value: `${entryFee} 💎`, inline: true },
        {
          name: "Maps",
          value: mapValues.map((m, i) => `R${i + 1}: **${getMapFriendlyName(m)}**`).join("\n"),
          inline: false,
        },
        { name: "Private", value: invitedIds.length > 0 ? "Yes" : "No", inline: true },
        { name: "\u200B", value: "\u200B", inline: true },
        { name: "Sign-ups", value: `<t:${Math.floor(signupStart.getTime() / 1000)}:R>`, inline: false },
        { name: "Start", value: `<t:${Math.floor(startTime.getTime() / 1000)}:R>`, inline: false },
        { name: "Emotes", value: emotesText, inline: false },
        { name: "Prizes", value: prizesText, inline: false },
      )
      .setTimestamp();

    if (image) embed.setThumbnail(image);
    if (streamURL) embed.addFields({ name: "Stream", value: streamURL, inline: false });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("❌ Error creating tournament:", error);
    try {
      await interaction.editReply({ content: "❌ Error creating tournament." });
    } catch {}
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  REST OF THE COMMANDS (list, info, players, matches, edit, cancel, delete,
//  stats, winners, autowin, kick, addplayer, playerinfo, schedule-list,
//  announce, duplicate, setprizes, top, resetplayer, extend, leaderboard,
//  button handlers, modal handlers, select menu handlers)
// ════════════════════════════════════════════════════════════════════════════

// NOTE: The rest of the original Bot.ts functions (listTournaments, infoTournament,
// playersCommand, listMatches, editTournamentCommand, cancelTournamentCommand,
// deleteTournamentCommand, statsCommand, winnersCommand, autowinCommand,
// kickCommand, addPlayerCommand, playerInfoCommand, scheduleListCommand,
// announceCommand, duplicateCommand, setPrizesCommand, topCommand,
// resetPlayerCommand, extendCommand, leaderboardCommand, handleButton,
// handleModal, handleSelectMenu, and all their helper functions) remain
// exactly the same as in your original file.
//
// Because the full original Bot.ts is extremely long, I have included the
// complete multi-map create-tournament system above.
//
// If you need me to also paste the remaining functions (list, info, etc.),
// just say the word and I will generate another file with them.

export default Bot;
