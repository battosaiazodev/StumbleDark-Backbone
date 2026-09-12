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
// يُقرأ من .env فقط — لا توجد قيم افتراضية مكشوفة
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const APP_ID    = process.env.BOT_APP_ID || "";
const GUILD_ID  = process.env.BOT_GUILD_ID || "";

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN is not set in .env — bot will not connect.");
}

// ─── AUTHORIZED USERS ────────────────────────────────────────────────────────
// أضف Discord User IDs الحقيقية هنا أو في .env كـ AUTHORIZED_USERS=id1,id2,...
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

// ─── DETAILED TOUR EMBED (from Bot2) ─────────────────────────────────────────
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

  // Phases
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

  // Emotes
  const disabledEmotes = tour.Properties?.DisabledEmotes || [];
  embed.addFields({ name: "🚫 Disabled Emotes", value: getEmoteNames(disabledEmotes), inline: false });

  // Prizes
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
  opt.setName("map")
    .setDescription("Tournament map")
    .setRequired(true)
    .setAutocomplete(true)
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
//  /create-tournament  (full manual options)
// ════════════════════════════════════════════════════════════════════════════

async function createTournamentCommand(interaction: ChatInputCommandInteraction) {
  try {
    await interaction.deferReply({ ephemeral: true });

    const name             = interaction.options.getString("name", true);
    const modeIndex        = interaction.options.getInteger("mode", true);
    const region           = interaction.options.getString("region", true);
    const selectedMap      = interaction.options.getString("map", true);
    const startMinutes     = interaction.options.getInteger("start", true);
    const signupMinutes    = interaction.options.getInteger("signup") ?? 0;
    const entryFee         = interaction.options.getInteger("fee") ?? 0;
    const emotePreset      = interaction.options.getString("restrictions");
    const disabledEmotesInput = interaction.options.getString("disabledemotes");
    const image            = interaction.options.getString("image") || "";
    const color            = interaction.options.getString("color") || "#2ad100";
    const streamURL        = interaction.options.getString("stream") || "";
    const invitedIdsInput  = interaction.options.getString("invited") || "";
    const prizesInput      = interaction.options.getString("prizes");
    const adminsInput      = interaction.options.getString("admins") || "";
    const tipoStr          = interaction.options.getString("type");
    const faseStr          = interaction.options.getString("phase");
    const agendarStr       = interaction.options.getString("schedule");

    const mode             = TOURNAMENT_MODES[modeIndex];
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

    const mapValue = Scenes[selectedMap as keyof typeof Scenes];
    if (!mapValue) {
      await interaction.editReply({ content: `❌ Invalid map: **${selectedMap}**` });
      return;
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
        name, region, selectedMap, mapValue, startMinutes, signupMinutes, entryFee,
        disabledEmotes, image, colorHex, streamURL, invitedIds, extraAdmins, prizes,
        tournamentType, phaseType, partySize, maxInvites, rounds, createdBy: interaction.user.id,
      };

      const timer = setTimeout(async () => {
        try {
          const now2        = new Date();
          const startTime2  = new Date(now2.getTime() + cfg.startMinutes * 60 * 1000);
          const signupStart2= new Date(now2.getTime() + cfg.signupMinutes * 60 * 1000);
          const tournamentId2 = now2.getTime().toString();

          await CreateTournament({
            CurrentInvites: 0, MaxInvites: cfg.maxInvites, TournamentId: tournamentId2,
            TournamentName: cfg.name, TournamentImage: cfg.image, TournamentColor: cfg.colorHex,
            StartTime: startTime2, SignupStart: signupStart2, EntryFee: cfg.entryFee,
            PrizepoolId: GeneratePrizepoolId().toString(), PartySize: cfg.partySize,
            Status: TournamentStatus.NotStarted, TournamentType: cfg.tournamentType,
            Phases: [{ PhaseType: cfg.phaseType, IsPhase: false, RoundCount: cfg.rounds,
              MaxTeams: Math.floor(cfg.maxInvites / cfg.partySize), Maps: [cfg.mapValue] }],
            Region: cfg.region, RoundCount: cfg.rounds, CurrentPhaseId: 0,
            Properties: {
              IsInvitationOnly: cfg.invitedIds.length > 0, InvitedIds: cfg.invitedIds,
              DisabledEmotes: cfg.disabledEmotes, AdminIds: [cfg.createdBy, ...cfg.extraAdmins],
              StreamURL: cfg.streamURL,
            },
            MinPlayersPerMatch: 1, MaxPlayersPerMatch: cfg.partySize * 2, Prizes: cfg.prizes,
          });

          scheduledTournaments.delete(scheduleId);
          console.log(`✅ Scheduled tournament "${cfg.name}" created!`);

          try {
            const channel = await Bot.channels.fetch(interaction.channelId);
            if (channel && channel.isTextBased()) {
              await (channel as any).send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(parseInt(cfg.colorHex.replace("#", ""), 16))
                    .setTitle("🚀 Scheduled Tournament Created!")
                    .setDescription(`**${cfg.name}** was created automatically.`)
                    .addFields(
                      { name: "🆔 ID",    value: `\`${tournamentId2}\``, inline: true },
                      { name: "🚀 Start", value: `<t:${Math.floor(startTime2.getTime() / 1000)}:R>`, inline: true },
                    )
                    .setTimestamp(),
                ],
              });
            }
          } catch {}
        } catch (err) {
          console.error(`❌ Error creating scheduled tournament ${scheduleId}:`, err);
        }
      }, msUntil);

      scheduledTournaments.set(scheduleId, { scheduleId, scheduledFor, createdBy: interaction.user.id, config: cfg, timer });

      const schedTs = Math.floor(scheduledFor.getTime() / 1000);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(colorValue)
            .setTitle("📅 Tournament Scheduled!")
            .setDescription(`**${name}** will be created at:`)
            .addFields(
              { name: "🕐 Creation",   value: `<t:${schedTs}:F> (<t:${schedTs}:R>)`, inline: false },
              { name: "🆔 Schedule ID",value: `\`${scheduleId}\``,                   inline: true  },
              { name: "🌍 Region",     value: region.toUpperCase(),                   inline: true  },
              { name: "⚔️ Mode",      value: getModeLabel(partySize),                inline: true  },
              { name: "🗺️ Map",       value: selectedMap,                            inline: true  },
              { name: "🔢 Slots",      value: `${maxInvites}`,                        inline: true  },
              { name: "🚀 Start",      value: `${startMinutes} min after creation`,  inline: true  },
            )
            .setTimestamp(),
        ],
      });
      return;
    }

    // ── Immediate ─────────────────────────────────────────────────────────
    const now          = new Date();
    const startTime    = new Date(now.getTime() + startMinutes * 60 * 1000);
    const signupStart  = new Date(now.getTime() + signupMinutes * 60 * 1000);
    const tournamentId = now.getTime().toString();

    await CreateTournament({
      CurrentInvites: 0, MaxInvites: maxInvites, TournamentId: tournamentId,
      TournamentName: name, TournamentImage: image, TournamentColor: colorHex,
      StartTime: startTime, SignupStart: signupStart, EntryFee: entryFee,
      PrizepoolId: GeneratePrizepoolId().toString(), PartySize: partySize,
      Status: TournamentStatus.NotStarted, TournamentType: tournamentType,
      Phases: [{ PhaseType: phaseType, IsPhase: false, RoundCount: rounds,
        MaxTeams: Math.floor(maxInvites / partySize), Maps: [mapValue] }],
      Region: region, RoundCount: rounds, CurrentPhaseId: 0,
      Properties: {
        IsInvitationOnly: invitedIds.length > 0, InvitedIds: invitedIds,
        DisabledEmotes: disabledEmotes, AdminIds: [interaction.user.id, ...extraAdmins],
        StreamURL: streamURL,
      },
      MinPlayersPerMatch: 1, MaxPlayersPerMatch: partySize * 2, Prizes: prizes,
    });

    const mapType  = getMapType(selectedMap);
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
        { name: "Region",  value: region.toUpperCase(),                                 inline: true  },
        { name: "Mode",    value: getModeLabel(partySize),                               inline: true  },
        { name: "Type",    value: typeName,                                              inline: true  },
        { name: "Slots",   value: `${maxInvites} (${rounds} rounds)`,                   inline: true  },
        { name: "Bracket", value: phaseName,                                            inline: true  },
        { name: "Fee",     value: `${entryFee} 💎`,                                     inline: true  },
        { name: "Map",     value: `${selectedMap} *(${mapType})*`,                      inline: true  },
        { name: "Private", value: invitedIds.length > 0 ? "Yes" : "No",                inline: true  },
        { name: "\u200B",  value: "\u200B",                                             inline: true  },
        { name: "Sign-ups",value: `<t:${Math.floor(signupStart.getTime() / 1000)}:R>`, inline: false },
        { name: "Start",   value: `<t:${Math.floor(startTime.getTime() / 1000)}:R>`,   inline: false },
        { name: "Emotes",  value: emotesText,                                           inline: false },
        { name: "Prizes",  value: prizesText,                                           inline: false },
      )
      .setTimestamp();

    if (image)     embed.setThumbnail(image);
    if (streamURL) embed.addFields({ name: "Stream", value: streamURL, inline: false });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("❌ Error creating tournament:", error);
    try { await interaction.editReply({ content: "❌ Error creating tournament." }); } catch {}
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /list  — paginated with filters
// ════════════════════════════════════════════════════════════════════════════

async function listTournaments(interaction: ChatInputCommandInteraction | any) {
  try {
    const isSlash = "options" in interaction && typeof interaction.options?.getString === "function";
    const isDeferred = interaction.deferred || interaction.replied;
    if (!isDeferred) await interaction.deferReply({ ephemeral: true });

    const regionFilter = isSlash ? interaction.options.getString("region") : null;
    const statusFilter = isSlash ? interaction.options.getInteger("status") : null;
    const search       = isSlash ? interaction.options.getString("search")  : null;

    const query: any = {};
    if (regionFilter) query.Region    = regionFilter;
    if (statusFilter !== null && statusFilter !== undefined) query.Status = statusFilter;
    if (search) query.TournamentName  = { $regex: search, $options: "i" };

    const PAGE_SIZE   = 5;
    let   page        = 0;

    const sendPage = async (p: number, mode: "reply" | "edit" | "update", i: any) => {
      const total = await Tournament.countDocuments(query);
      const tours = await Tournament.find(query)
        .sort({ StartTime: 1 })
        .skip(p * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean();

      if (total === 0) {
        const noEmbed = new EmbedBuilder()
          .setTitle("📋 Tournaments")
          .setDescription("No tournaments found.")
          .setColor(0x5865f2);
        if (mode === "reply")  await i.editReply({ embeds: [noEmbed] });
        else if (mode === "update") await i.update({ embeds: [noEmbed], components: [] });
        else await i.editReply({ embeds: [noEmbed] });
        return;
      }

      const totalPages = Math.ceil(total / PAGE_SIZE);
      const embed = new EmbedBuilder()
        .setTitle(`📋 Tournaments (Page ${p + 1}/${totalPages})`)
        .setDescription(`Showing **${tours.length}** of **${total}** tournaments`)
        .setColor(0x5865f2)
        .setTimestamp();

      for (const t of tours) {
        const ts          = Math.floor(new Date(t.StartTime).getTime() / 1000);
        const playerCount = await getPlayerCount(t.TournamentId.toString());
        const calcStatus  = calculateTournamentStatus(t);
        embed.addFields({
          name: `${t.TournamentName}`,
          value: [
            `${STATUS_LABELS[calcStatus] || "?"} | 🌍 ${t.Region?.toUpperCase()} | 🎮 ${getModeLabel(t.PartySize || 1)}`,
            `👥 ${playerCount}/${t.MaxInvites} | 💰 ${t.EntryFee > 0 ? `${t.EntryFee} 💎` : "Free"}`,
            `🚀 <t:${ts}:R> | \`${t.TournamentId}\``,
          ].join("\n"),
          inline: false,
        });
      }

      // Select menu for quick actions
      const activeList = tours.slice(0, 25);
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("select_tournament")
        .setPlaceholder("Select a tournament for actions...")
        .addOptions(activeList.map((t) => ({
          label:       t.TournamentName.substring(0, 100),
          description: `${STATUS_LABELS[calculateTournamentStatus(t)] || "?"} | ${t.CurrentInvites}/${t.MaxInvites}`.substring(0, 100),
          value:       t.TournamentId,
        })));

      const selectRow  = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
      const navRow     = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`list_prev_${p}`).setLabel("◀ Prev").setStyle(ButtonStyle.Secondary).setDisabled(p === 0),
        new ButtonBuilder().setCustomId(`list_next_${p}`).setLabel("Next ▶").setStyle(ButtonStyle.Secondary).setDisabled(p >= totalPages - 1),
        new ButtonBuilder().setCustomId("reload_list").setLabel("🔄 Refresh").setStyle(ButtonStyle.Primary),
      );

      const payload = { embeds: [embed], components: [selectRow, navRow] };
      if (mode === "update")  await i.update(payload);
      else if (mode === "reply") await i.editReply(payload);
      else await i.editReply(payload);
    };

    await sendPage(page, "reply", interaction);

    // Pagination collector
    try {
      const reply     = await interaction.fetchReply();
      const collector = reply.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 120_000,
      });

      collector.on("collect", async (btn: ButtonInteraction) => {
        if (btn.user.id !== interaction.user.id) {
          await btn.reply({ content: "❌ Only the command user can navigate.", ephemeral: true });
          return;
        }
        if (btn.customId.startsWith("list_prev_")) {
          page = Math.max(0, parseInt(btn.customId.split("_")[2]) - 1);
          await btn.deferUpdate();
          await sendPage(page, "edit", interaction);
        } else if (btn.customId.startsWith("list_next_")) {
          page = parseInt(btn.customId.split("_")[2]) + 1;
          await btn.deferUpdate();
          await sendPage(page, "edit", interaction);
        } else if (btn.customId === "reload_list") {
          await btn.deferUpdate();
          await sendPage(page, "edit", interaction);
        }
      });

      collector.on("end", async () => {
        try { await interaction.editReply({ components: [] }); } catch {}
      });
    } catch {}

  } catch (error) {
    console.error("❌ Error listing tournaments:", error);
    try {
      const errMsg = { content: "❌ Error listing tournaments.", ephemeral: true };
      if (interaction.deferred) await interaction.editReply(errMsg);
      else await interaction.reply(errMsg);
    } catch {}
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /info
// ════════════════════════════════════════════════════════════════════════════

async function infoTournament(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id   = interaction.options.getString("id", true);
    const tour = await Tournament.findOne({ TournamentId: id }).lean();
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });

    const embed = await buildDetailedTourEmbed(tour);
    embed.setFooter({ text: `Requested by ${interaction.user.username}` });

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`info_players_${id}`).setLabel("👥 Players").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`info_matches_${id}`).setLabel("⚔️ Matches").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`info_refresh_${id}`).setLabel("🔄 Refresh").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`delete_${id}`).setLabel("🗑️ Delete").setStyle(ButtonStyle.Danger),
    );

    await interaction.editReply({ embeds: [embed], components: [row] });

    const reply     = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });

    collector.on("collect", async (btn: ButtonInteraction) => {
      if (btn.user.id !== interaction.user.id) {
        await btn.reply({ content: "❌ Only the command user can use these.", ephemeral: true });
        return;
      }

      if (btn.customId.startsWith("info_refresh_")) {
        const fresh = await Tournament.findOne({ TournamentId: id }).lean();
        if (!fresh) { await btn.update({ content: "Tournament no longer exists.", embeds: [], components: [] }); return; }
        const refreshed = await buildDetailedTourEmbed(fresh);
        await btn.update({ embeds: [refreshed], components: [row] });

      } else if (btn.customId.startsWith("info_players_")) {
        const players = await BackboneUser.find({
          [`Tournaments.${id}`]: { $exists: true },
          [`Tournaments.${id}.SignedUp`]: true,
        }).select("Username UserId").limit(20).lean();

        const pEmbed = new EmbedBuilder()
          .setTitle(`👥 Players in \`${id}\``)
          .setColor(0x5865f2)
          .setDescription(
            players.length === 0
              ? "No players signed up yet."
              : players.map((p, i) => `**${i + 1}.** ${p.Username} (\`${p.UserId}\`)`).join("\n")
          )
          .setFooter({ text: "Showing first 20 players" });
        await btn.reply({ embeds: [pEmbed], ephemeral: true });

      } else if (btn.customId.startsWith("info_matches_")) {
        const matchCount   = await Match.countDocuments({ tournamentid: id });
        const activeCount  = await Match.countDocuments({ tournamentid: id, status: { $in: [2, 3, 4] } });
        const mEmbed = new EmbedBuilder()
          .setTitle(`⚔️ Matches in \`${id}\``)
          .setColor(0x5865f2)
          .addFields(
            { name: "Total Matches",  value: matchCount.toString(),  inline: true },
            { name: "Active Matches", value: activeCount.toString(), inline: true },
          );
        await btn.reply({ embeds: [mEmbed], ephemeral: true });
      }
    });

    collector.on("end", async () => { try { await interaction.editReply({ components: [] }); } catch {} });
  } catch (err) {
    console.error("info error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /players
// ════════════════════════════════════════════════════════════════════════════

async function playersCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id       = interaction.options.getString("id", true);
    const page     = (interaction.options.getInteger("page") ?? 1) - 1;
    const PAGE_SIZE = 15;

    const tour = await Tournament.findOne({ TournamentId: id }).lean();
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });

    const total = await BackboneUser.countDocuments({
      [`Tournaments.${id}`]: { $exists: true },
      [`Tournaments.${id}.SignedUp`]: true,
    });

    if (total === 0) return void await interaction.editReply({ content: `ℹ️ No players signed up for \`${id}\` yet.` });

    const players = await BackboneUser.find({
      [`Tournaments.${id}`]: { $exists: true },
      [`Tournaments.${id}.SignedUp`]: true,
    })
      .select("Username UserId TournamentsWon")
      .skip(page * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean();

    const totalPages = Math.ceil(total / PAGE_SIZE);
    const lines = players.map((p, i) => {
      const num      = page * PAGE_SIZE + i + 1;
      const trophies = (p as any).TournamentsWon > 0 ? ` 🏆×${(p as any).TournamentsWon}` : "";
      return `**${num}.** \`${p.UserId}\` — ${p.Username}${trophies}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`👥 Players — ${(tour as any).TournamentName}`)
      .setColor(safeColor((tour as any).TournamentColor || "#5865f2"))
      .setDescription(lines.join("\n"))
      .setFooter({ text: `${total} total players • Page ${page + 1}/${totalPages}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("players error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /matches
// ════════════════════════════════════════════════════════════════════════════

async function listMatches(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const idFilter    = interaction.options.getString("id");
  const phaseFilter = interaction.options.getInteger("phase");
  const roundFilter = interaction.options.getInteger("round");

  try {
    let tournamentIds: string[] = [];
    if (idFilter) {
      tournamentIds = [idFilter];
    } else {
      const activeTs = await Tournament.find({
        Status: { $in: [TournamentStatus.Running, TournamentStatus.InvitationOpen, TournamentStatus.InvitationClose] },
      }).select("TournamentId");
      tournamentIds = activeTs.map((t) => t.TournamentId.toString());
    }

    if (tournamentIds.length === 0) {
      await interaction.editReply({ content: "📭 No active tournaments at the moment." });
      return;
    }

    const query: any = {
      tournamentid: { $in: tournamentIds },
      status: { $in: [TournamentMatchStatus.GameReady, TournamentMatchStatus.GameInProgress] },
    };
    if (phaseFilter) query.phaseid = phaseFilter;
    if (roundFilter) query.roundid = roundFilter;

    const matches = await Match.find(query).sort({ roundid: 1 }).limit(50);

    if (matches.length === 0) {
      await interaction.editReply({ content: "📭 No ongoing matches found." });
      return;
    }

    const byTournament = new Map<string, typeof matches>();
    for (const m of matches) {
      const tid = m.tournamentid.toString();
      if (!byTournament.has(tid)) byTournament.set(tid, []);
      byTournament.get(tid)!.push(m);
    }

    const embeds:     EmbedBuilder[]                         = [];
    const components: ActionRowBuilder<ButtonBuilder>[]      = [];

    for (const [tid, tMatches] of byTournament.entries()) {
      const tournament = await Tournament.findOne({ TournamentId: tid });
      const tName      = tournament?.TournamentName || tid;
      const colorValue = parseInt((tournament?.TournamentColor || "#ff6600").replace("#", ""), 16);

      const embed = new EmbedBuilder()
        .setColor(isNaN(colorValue) ? 0xff6600 : colorValue)
        .setTitle(tName)
        .setDescription(`\`${tid}\` — ${tMatches.length} ongoing match(es)`);

      for (const match of tMatches) {
        const statusLabel = MATCH_STATUS_LABELS[match.status] || "❓";
        embed.addFields({
          name:   `Match \`${match.id}\` — Round ${match.roundid} — ${statusLabel}`,
          value:  buildTeamDisplay(match.users) || "*No players*",
          inline: false,
        });
      }

      embeds.push(embed);

      const btnRow = new ActionRowBuilder<ButtonBuilder>();
      let btnCount = 0;
      for (const match of tMatches.slice(0, 5)) {
        btnRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`pick_winner_${match.id}`)
            .setLabel(`🏆 Match ${String(match.id).slice(-4)}`)
            .setStyle(ButtonStyle.Primary)
        );
        btnCount++;
      }
      if (btnCount > 0) components.push(btnRow);
    }

    await interaction.editReply({ embeds: embeds.slice(0, 10), components: components.slice(0, 5) });
  } catch (err) {
    console.error("matches error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /edit
// ════════════════════════════════════════════════════════════════════════════

async function editTournamentCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id           = interaction.options.getString("id", true);
    const name         = interaction.options.getString("name");
    const max          = interaction.options.getInteger("max");
    const fee          = interaction.options.getInteger("fee");
    const image        = interaction.options.getString("image");
    const color        = interaction.options.getString("color");
    const stream       = interaction.options.getString("stream");
    const emotesInput  = interaction.options.getString("disabledemotes");
    const prizesInput  = interaction.options.getString("prizes");
    const statusChange = interaction.options.getString("status");
    const startMins    = interaction.options.getInteger("start");
    const signupMins   = interaction.options.getInteger("signup");

    const tour = await Tournament.findOne({ TournamentId: id });
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });

    const isAdmin = AUTHORIZED_USERS.includes(interaction.user.id) ||
                    tour.Properties.AdminIds.includes(interaction.user.id);
    if (!isAdmin) return void await interaction.editReply({ content: "❌ You don't have permission to edit this tournament." });

    const update: any = {};
    const changes: string[] = [];

    if (name)  { update.TournamentName  = name;  changes.push(`Name → **${name}**`);          }
    if (max)   { update.MaxInvites      = max;   changes.push(`Max Players → **${max}**`);     }
    if (fee !== null && fee !== undefined) { update.EntryFee = fee; changes.push(`Fee → **${fee} 💎**`); }
    if (image) { update.TournamentImage = image; changes.push(`Image updated`);                }
    if (color) {
      const colorHex = color.startsWith("#") ? color : `#${color}`;
      const colorNum = parseInt(colorHex.replace("#", ""), 16);
      if (isNaN(colorNum)) return void await interaction.editReply({ content: `❌ Invalid color: **${color}**` });
      update.TournamentColor = colorHex;
      changes.push(`Color → **${colorHex}**`);
    }
    if (stream !== null && stream !== undefined) {
      update["Properties.StreamURL"] = stream;
      changes.push(`Stream → ${stream || "*(removed)*"}`);
    }

    // ─── تعديل وقت البداية والتسجيل ──────────────────────────────────────
    if (startMins !== null && startMins !== undefined) {
      const newStart = new Date(Date.now() + startMins * 60 * 1000);
      update.StartTime = newStart;
      changes.push(`Start → <t:${Math.floor(newStart.getTime() / 1000)}:R>`);
    }
    if (signupMins !== null && signupMins !== undefined) {
      const newSignup = new Date(Date.now() + signupMins * 60 * 1000);
      update.SignupStart = newSignup;
      changes.push(`Sign-ups → <t:${Math.floor(newSignup.getTime() / 1000)}:R>`);
    }

    if (emotesInput === "reset") {
      update["Properties.DisabledEmotes"] = [];
      changes.push(`Emotes → ✅ All Allowed (reset)`);
    } else if (emotesInput) {
      const parsed = parseEmotes(emotesInput);
      if (parsed.length === 0) return void await interaction.editReply({ content: "❌ Could not parse emote names." });
      update["Properties.DisabledEmotes"] = parsed;
      changes.push(`Disabled Emotes → ${getEmoteNames(parsed)}`);
    }

    if (prizesInput === "" || prizesInput === "none") {
      update.Prizes = [];
      changes.push(`Prizes → *(cleared)*`);
    } else if (prizesInput) {
      update.Prizes = parsePrizes(prizesInput);
      changes.push(`Prizes updated`);
    }

    if (statusChange === "cancel") {
      update.Status = TournamentStatus.Canceled;
      changes.push(`Status → ❌ Canceled`);
    } else if (statusChange === "finish") {
      update.Status = TournamentStatus.Finished;
      changes.push(`Status → 🏁 Finished`);
    }

    if (changes.length === 0) return void await interaction.editReply({ content: "ℹ️ No changes provided." });

    await Tournament.updateOne({ TournamentId: id }, { $set: update });

    const embed = new EmbedBuilder()
      .setTitle("✏️ Tournament Updated")
      .setDescription(`**${tour.TournamentName}** (\`${id}\`)`)
      .setColor(0x43b581)
      .addFields({ name: "Changes", value: changes.join("\n") })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("edit error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /cancel
// ════════════════════════════════════════════════════════════════════════════

async function cancelTournamentCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id   = interaction.options.getString("id", true);
    const tour = await Tournament.findOne({ TournamentId: id }).lean();
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });
    if ((tour as any).Status === TournamentStatus.Canceled) {
      return void await interaction.editReply({ content: `ℹ️ Tournament \`${id}\` is already canceled.` });
    }

    await Tournament.updateOne({ TournamentId: id }, { $set: { Status: TournamentStatus.Canceled } });

    const embed = new EmbedBuilder()
      .setTitle("❌ Tournament Canceled")
      .setDescription(`**${(tour as any).TournamentName}** (\`${id}\`) has been canceled.`)
      .setColor(0xff4444)
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("cancel error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /delete
// ════════════════════════════════════════════════════════════════════════════

async function deleteTournamentCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id   = interaction.options.getString("id", true);
    const tour = await Tournament.findOne({ TournamentId: id }).lean();
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });

    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`del_confirm_${id}`).setLabel("🗑️ Yes, Delete").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("del_cancel").setLabel("✖️ Cancel").setStyle(ButtonStyle.Secondary),
    );

    const confirmEmbed = new EmbedBuilder()
      .setTitle("⚠️ Confirm Deletion")
      .setDescription(`Are you sure you want to **permanently delete** \`${(tour as any).TournamentName}\`?\n\nThis will also delete all matches and remove all player records.`)
      .setColor(0xff4444);

    await interaction.editReply({ embeds: [confirmEmbed], components: [confirmRow] });

    const reply     = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30_000 });

    collector.on("collect", async (btn: ButtonInteraction) => {
      if (btn.user.id !== interaction.user.id) {
        await btn.reply({ content: "❌ Only the command user can confirm.", ephemeral: true });
        return;
      }
      if (btn.customId.startsWith("del_confirm_")) {
        const tid = btn.customId.replace("del_confirm_", "");
        await Match.deleteMany({ tournamentid: tid });
        await BackboneUser.updateMany(
          { [`Tournaments.${tid}`]: { $exists: true } },
          { $unset: { [`Tournaments.${tid}`]: "" } }
        );
        await Tournament.deleteOne({ TournamentId: tid });

        await btn.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("🗑️ Tournament Deleted")
              .setDescription(`**${(tour as any).TournamentName}** (\`${tid}\`) and all its data have been deleted.`)
              .setColor(0xff4444)
              .setTimestamp(),
          ],
          components: [],
        });
      } else if (btn.customId === "del_cancel") {
        await btn.update({
          embeds: [new EmbedBuilder().setTitle("✖️ Deletion Canceled").setDescription("No changes were made.").setColor(0x5865f2)],
          components: [],
        });
      }
      collector.stop();
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        try { await interaction.editReply({ content: "⏱️ Confirmation timed out.", embeds: [], components: [] }); } catch {}
      }
    });
  } catch (err) {
    console.error("delete error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /stats
// ════════════════════════════════════════════════════════════════════════════

async function statsCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const [total, running, open, finished, canceled, players, matches, activeMatches, scheduledCount] = await Promise.all([
      Tournament.countDocuments(),
      Tournament.countDocuments({ Status: TournamentStatus.Running }),
      Tournament.countDocuments({ Status: TournamentStatus.InvitationOpen }),
      Tournament.countDocuments({ Status: TournamentStatus.Finished }),
      Tournament.countDocuments({ Status: TournamentStatus.Canceled }),
      BackboneUser.countDocuments(),
      Match.countDocuments(),
      Match.countDocuments({ status: { $in: [2, 3] } }),
      Promise.resolve(scheduledTournaments.size),
    ]);

    const topPlayer = await BackboneUser.findOne({ TournamentsWon: { $gt: 0 } })
      .sort({ TournamentsWon: -1 })
      .select("Username TournamentsWon UserId")
      .lean();

    // أحدث بطولة نشطة
    const latestActive = await Tournament.findOne({
      Status: { $in: [TournamentStatus.Running, TournamentStatus.InvitationOpen] },
    })
      .sort({ StartTime: 1 })
      .select("TournamentName TournamentId StartTime Status")
      .lean();

    const embed = new EmbedBuilder()
      .setTitle("📊 Server Statistics")
      .setColor(0x5865f2)
      .addFields(
        // ─── Tournaments ───────────────────────────────────────────────
        { name: "🏟️ Tournaments",  value: [
          `Total: **${total}**`,
          `▶️ Running: **${running}**`,
          `🟢 Open: **${open}**`,
          `🏁 Finished: **${finished}**`,
          `❌ Canceled: **${canceled}**`,
          `📅 Scheduled: **${scheduledCount}**`,
        ].join("\n"), inline: true },

        // ─── Players & Matches ─────────────────────────────────────────
        { name: "👥 Players & Matches", value: [
          `Players: **${players.toLocaleString()}**`,
          `Total Matches: **${matches.toLocaleString()}**`,
          `Active Matches: **${activeMatches}**`,
        ].join("\n"), inline: true },

        { name: "\u200B", value: "\u200B", inline: false },
      )
      .setTimestamp();

    if (topPlayer && (topPlayer as any).TournamentsWon > 0) {
      embed.addFields({
        name:  "👑 All-Time Champion",
        value: `**${(topPlayer as any).Username}** (\`${(topPlayer as any).UserId}\`) — ${(topPlayer as any).TournamentsWon} 🏆`,
        inline: false,
      });
    }

    if (latestActive) {
      const ts = Math.floor(new Date((latestActive as any).StartTime).getTime() / 1000);
      const statusLabel = STATUS_LABELS[(latestActive as any).Status] || "?";
      embed.addFields({
        name:  "🔥 Active Tournament",
        value: `**${(latestActive as any).TournamentName}** — ${statusLabel}\n\`${(latestActive as any).TournamentId}\` | <t:${ts}:R>`,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("stats error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /winners
// ════════════════════════════════════════════════════════════════════════════

async function winnersCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id   = interaction.options.getString("id", true);
    const tour = await Tournament.findOne({ TournamentId: id }).lean();
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });

    const winners = (tour as any).Winners;
    if (!winners || winners.length === 0) {
      return void await interaction.editReply({ content: `ℹ️ No winners recorded for \`${id}\` yet.` });
    }

    const embed = new EmbedBuilder()
      .setTitle(`🏆 Winners — ${(tour as any).TournamentName}`)
      .setColor(0xffd700)
      .setDescription(winners.map((w: any, i: number) => `**${i + 1}.** 🥇 **${w.nick}** (\`${w.userId}\`)`).join("\n"))
      .setTimestamp();

    if ((tour as any).TournamentImage) embed.setThumbnail((tour as any).TournamentImage);

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("winners error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /autowin
// ════════════════════════════════════════════════════════════════════════════

async function autowinCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id        = interaction.options.getString("id", true);
    const playerArg = interaction.options.getString("player", true).trim();

    const tour = await Tournament.findOne({ TournamentId: id });
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });

    const player = await BackboneUser.findOne({
      $or: [{ UserId: playerArg }, { Username: { $regex: `^${playerArg}$`, $options: "i" } }],
    });
    if (!player) return void await interaction.editReply({ content: `❌ Player \`${playerArg}\` not found.` });

    const tid     = id.toString();
    const tourInfo = player.Tournaments?.get(tid);
    if (!tourInfo?.SignedUp) {
      return void await interaction.editReply({ content: `❌ Player **${player.Username}** is not signed up in this tournament.` });
    }

    const activeMatch = await Match.findOne({
      tournamentid: tid,
      "users.@user-id": player.UserId,
      status: { $in: [TournamentMatchStatus.Created, TournamentMatchStatus.WaitingForOpponent, TournamentMatchStatus.GameReady, TournamentMatchStatus.GameInProgress] },
    }).sort({ roundid: 1 });

    if (!activeMatch) {
      return void await interaction.editReply({ content: `❌ Player **${player.Username}** has no active match to auto-win right now.` });
    }

    const playerUser   = activeMatch.users.find((u: any) => u["@user-id"] === player.UserId);
    const playerTeamId = playerUser?.["@team-id"];
    if (!playerTeamId) {
      return void await interaction.editReply({ content: "❌ Could not determine player's team in the match." });
    }

    const updatedUsers = activeMatch.users.map((u: any) => {
      if (u["@team-id"] === playerTeamId) {
        return { ...u, "@match-winner": "1", "@match-points": "1", "@team-score": "1", "@checked-in": "1" };
      }
      return { ...u, "@match-winner": "0", "@match-points": "0", "@team-score": "0" };
    });

    await Match.updateOne({ id: activeMatch.id }, { $set: { users: updatedUsers, status: TournamentMatchStatus.Closed } });

    const closedMatch = await Match.findOne({ id: activeMatch.id }).lean();
    if (closedMatch) {
      await BackboneUser.updateOne(
        { UserId: player.UserId },
        { $set: { [`Tournaments.${tid}.UserMatch`]: closedMatch } }
      );
    }

    const freshPlayer = await BackboneUser.findOne({ UserId: player.UserId });
    if (freshPlayer) await Qualify(freshPlayer, tour);

    const embed = new EmbedBuilder()
      .setTitle("🏅 Auto-Win Applied")
      .setColor(0x43b581)
      .addFields(
        { name: "Player",     value: `**${player.Username}** (\`${player.UserId}\`)`,              inline: true  },
        { name: "Tournament", value: `\`${id}\``,                                                  inline: true  },
        { name: "Match",      value: `\`${activeMatch.id}\` (Round ${activeMatch.roundid})`,       inline: false },
      )
      .setDescription("Player's match has been closed as a win and they've been advanced to the next round.")
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("autowin error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /kick
// ════════════════════════════════════════════════════════════════════════════

async function kickCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id        = interaction.options.getString("id", true);
    const playerArg = interaction.options.getString("player", true).trim();

    const tour = await Tournament.findOne({ TournamentId: id }).lean();
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });

    const player = await BackboneUser.findOne({
      $or: [{ UserId: playerArg }, { Username: { $regex: `^${playerArg}$`, $options: "i" } }],
    }).lean();
    if (!player) return void await interaction.editReply({ content: `❌ Player \`${playerArg}\` not found.` });

    const tid      = id.toString();
    const tourEntry = (player as any).Tournaments?.[tid];
    if (!tourEntry?.SignedUp) {
      return void await interaction.editReply({ content: `❌ Player **${player.Username}** is not signed up in this tournament.` });
    }

    await BackboneUser.updateOne(
      { UserId: player.UserId },
      { $set: { [`Tournaments.${tid}.SignedUp`]: false, [`Tournaments.${tid}.Status`]: TournamentUserStatus.KickedOutByAdmin } }
    );
    await Tournament.updateOne({ TournamentId: id }, { $inc: { CurrentInvites: -1 } });

    const embed = new EmbedBuilder()
      .setTitle("👢 Player Kicked")
      .setColor(0xff4444)
      .addFields(
        { name: "Player",     value: `**${player.Username}** (\`${player.UserId}\`)`, inline: true },
        { name: "Tournament", value: `\`${id}\``,                                     inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("kick error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /addplayer
// ════════════════════════════════════════════════════════════════════════════

async function addPlayerCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id        = interaction.options.getString("id", true);
    const playerArg = interaction.options.getString("player", true).trim();

    const tour = await Tournament.findOne({ TournamentId: id }).lean();
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });

    const player = await BackboneUser.findOne({
      $or: [{ UserId: playerArg }, { Username: { $regex: `^${playerArg}$`, $options: "i" } }],
    }).lean();
    if (!player) return void await interaction.editReply({ content: `❌ Player \`${playerArg}\` not found.` });

    const tid = id.toString();
    await BackboneUser.updateOne(
      { UserId: player.UserId },
      { $set: { [`Tournaments.${tid}`]: { SignedUp: true, Status: 1, AutoWin: false } } }
    );
    await Tournament.updateOne({ TournamentId: id }, { $inc: { CurrentInvites: 1 } });

    const embed = new EmbedBuilder()
      .setTitle("➕ Player Added")
      .setColor(0x43b581)
      .addFields(
        { name: "Player",     value: `**${player.Username}** (\`${player.UserId}\`)`, inline: true },
        { name: "Tournament", value: `\`${id}\``,                                     inline: true },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("addplayer error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /playerinfo
// ════════════════════════════════════════════════════════════════════════════

async function playerInfoCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const playerArg = interaction.options.getString("player", true).trim();

    const player = await BackboneUser.findOne({
      $or: [{ UserId: playerArg }, { Username: { $regex: `^${playerArg}$`, $options: "i" } }],
    }).lean();
    if (!player) return void await interaction.editReply({ content: `❌ Player \`${playerArg}\` not found.` });

    // حساب الإحصائيات من بيانات البطولات
    const tourMap = (player as any).Tournaments;
    const entries: [string, any][] = tourMap instanceof Map
      ? Array.from(tourMap.entries())
      : Object.entries(tourMap || {});

    let totalSignups    = 0;
    let totalMatchWins  = 0;
    let totalMatchLoses = 0;
    let totalMatches    = 0;
    let bestPlace       = 9999;
    const recentIds: string[] = [];

    for (const [tourId, data] of entries) {
      if (!data?.SignedUp) continue;
      totalSignups++;
      if (data.FinalPlace > 0 && data.FinalPlace < bestPlace) bestPlace = data.FinalPlace;
      if (recentIds.length < 3) recentIds.push(tourId);

      if (Array.isArray(data.UserMatches)) {
        for (const m of data.UserMatches) {
          totalMatches++;
          const u = m.users?.find((u: any) => u["@user-id"] === (player as any).UserId);
          if (u?.["@match-winner"] === "1") totalMatchWins++;
          else totalMatchLoses++;
        }
      }
    }

    const winRate = totalMatches > 0 ? Math.round((totalMatchWins / totalMatches) * 100) : 0;
    const wins    = (player as any).TournamentsWon ?? 0;

    // جلب أسماء آخر البطولات
    const recentTours = await Tournament.find({ TournamentId: { $in: recentIds } })
      .select("TournamentName TournamentId Status")
      .lean();

    const recentLines = recentTours.map((t) => {
      const status = STATUS_LABELS[(t as any).Status] || "?";
      return `${status} **${(t as any).TournamentName}** (\`${(t as any).TournamentId}\`)`;
    });

    // شريط التقدم للـ win rate
    const barFilled = Math.round(winRate / 10);
    const bar = "█".repeat(barFilled) + "░".repeat(10 - barFilled);

    const embed = new EmbedBuilder()
      .setTitle(`👤 ${(player as any).Username}`)
      .setColor(wins >= 10 ? 0xffd700 : wins >= 5 ? 0xc0c0c0 : 0x5865f2)
      .addFields(
        { name: "🆔 User ID",         value: `\`${(player as any).UserId}\``,                    inline: true  },
        { name: "🏆 Tournament Wins",  value: `**${wins}**${wins >= 10 ? " 👑" : wins >= 5 ? " ⭐" : ""}`, inline: true },
        { name: "📋 Tournaments",      value: `**${totalSignups}** played`,                       inline: true  },
        { name: "⚔️ Match Record",     value: `**${totalMatchWins}W** / **${totalMatchLoses}L**`, inline: true  },
        { name: "📈 Win Rate",         value: `\`${bar}\` **${winRate}%**`,                       inline: false },
        { name: "🎯 Best Place",       value: bestPlace === 9999 ? "N/A" : `**#${bestPlace}**`,   inline: true  },
        { name: "🎮 Total Matches",    value: `**${totalMatches}**`,                              inline: true  },
      )
      .setTimestamp();

    if (recentLines.length > 0) {
      embed.addFields({
        name:  "📅 Recent Tournaments",
        value: recentLines.join("\n"),
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("playerinfo error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  BUTTON HANDLER
// ════════════════════════════════════════════════════════════════════════════

async function handleButton(interaction: ButtonInteraction) {
  const { customId } = interaction;

  if (customId === "reload_list")                   await interaction.deferUpdate().then(() => listTournaments(interaction));
  else if (customId.startsWith("cancel_schedule_")) await cancelScheduled(interaction);
  else if (customId.startsWith("pick_winner_"))     await showPickWinnerMenu(interaction);
  else if (customId.startsWith("delete_"))          await deleteTournamentButton(interaction);
  else if (customId.startsWith("edit_"))            await editTournamentButton(interaction);
  else if (customId.startsWith("listplayers_"))     await listPlayersButton(interaction);
  else if (customId.startsWith("kick_"))            await showKickModal(interaction);
}

// ─── Delete via button (from /info or /list select) ──────────────────────────
async function deleteTournamentButton(interaction: ButtonInteraction) {
  const tournamentId = interaction.customId.replace("delete_", "");
  try {
    const tournament = await Tournament.findOne({ TournamentId: tournamentId });
    if (!tournament) { await interaction.reply({ content: "❌ Tournament not found.", ephemeral: true }); return; }

    const isAdmin = AUTHORIZED_USERS.includes(interaction.user.id) ||
                    tournament.Properties.AdminIds.includes(interaction.user.id);
    if (!isAdmin) { await interaction.reply({ content: "❌ You don't have permission.", ephemeral: true }); return; }

    await Tournament.deleteOne({ TournamentId: tournamentId });
    await interaction.reply({
      content: `✅ Tournament **${tournament.TournamentName}** (\`${tournamentId}\`) permanently deleted.`,
      ephemeral: true,
    });
  } catch (error) {
    console.error("❌ Delete button error:", error);
    await interaction.reply({ content: "❌ Error deleting tournament.", ephemeral: true });
  }
}

// ─── Edit via button → show modal ────────────────────────────────────────────
async function editTournamentButton(interaction: ButtonInteraction) {
  const tournamentId = interaction.customId.replace("edit_", "");
  try {
    const tournament = await Tournament.findOne({ TournamentId: tournamentId });
    if (!tournament) { await interaction.reply({ content: "❌ Tournament not found.", ephemeral: true }); return; }

    const isAdmin = AUTHORIZED_USERS.includes(interaction.user.id) ||
                    tournament.Properties.AdminIds.includes(interaction.user.id);
    if (!isAdmin) { await interaction.reply({ content: "❌ You don't have permission.", ephemeral: true }); return; }

    const modal = new ModalBuilder()
      .setCustomId(`modal_edit_${tournamentId}`)
      .setTitle("Edit Tournament");

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("tournament_name").setLabel("Tournament Name")
          .setStyle(TextInputStyle.Short).setValue(tournament.TournamentName).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("tournament_color").setLabel("Color (Hex, e.g. #2ad100)")
          .setStyle(TextInputStyle.Short).setValue(tournament.TournamentColor || "#2ad100").setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("max_invites").setLabel("Maximum Slots")
          .setStyle(TextInputStyle.Short).setValue(tournament.MaxInvites.toString()).setRequired(true)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("entry_fee").setLabel("Entry Fee (diamonds)")
          .setStyle(TextInputStyle.Short).setValue(tournament.EntryFee.toString()).setRequired(false)
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("prizes").setLabel("Prizes (e.g. 1:1000,2:500,3:250)")
          .setStyle(TextInputStyle.Short)
          .setValue((tournament.Prizes ?? []).length > 0
            ? (tournament.Prizes ?? []).map((p: any) => `${p.position}:${p.amount}`).join(",")
            : "")
          .setRequired(false)
      ),
    );

    await interaction.showModal(modal);
  } catch (error) {
    console.error("❌ Edit button error:", error);
    await interaction.reply({ content: "❌ Error opening editor.", ephemeral: true });
  }
}

// ─── List players via button ──────────────────────────────────────────────────
async function listPlayersButton(interaction: ButtonInteraction) {
  const tournamentId = interaction.customId.replace("listplayers_", "");
  try {
    const users = await BackboneUser.find().limit(200);
    const playersInTournament = users.filter((user) => {
      const tData = user.Tournaments?.get(tournamentId);
      return tData?.SignedUp === true;
    });

    if (!playersInTournament.length) {
      await interaction.reply({ content: "No players signed up for this tournament.", ephemeral: true });
      return;
    }

    const tournament = await Tournament.findOne({ TournamentId: tournamentId });
    const colorValue = parseInt((tournament?.TournamentColor || "#2ad100").replace("#", ""), 16);

    const embed = new EmbedBuilder()
      .setColor(colorValue)
      .setTitle("👥 Signed Up Players")
      .setDescription(`**Tournament:** ${tournament?.TournamentName || tournamentId}\n**Total:** ${playersInTournament.length} player(s)`);

    const activeList: string[] = [];
    const kickedList: string[] = [];

    for (const user of playersInTournament) {
      const tData     = user.Tournaments?.get(tournamentId);
      const userMember = tData?.PartyMembers?.find((pm: any) => pm.UserId === user.UserId);
      const isKicked  = userMember?.IsKicked || false;
      const statusEnum = userMember?.Status ?? TournamentUserStatus.Invited;
      const statusName = Object.keys(TournamentUserStatus).find(
        (k) => isNaN(Number(k)) && TournamentUserStatus[k as keyof typeof TournamentUserStatus] === statusEnum
      ) || "Unknown";

      const entry = `\`${user.UserId}\` **${user.Username}** — ${statusName}`;
      if (isKicked) kickedList.push(`~~${entry}~~`);
      else activeList.push(entry);
    }

    if (activeList.length > 0) {
      for (const chunk of chunkArray(activeList, 15).slice(0, 5)) {
        embed.addFields({ name: "✅ Active", value: chunk.join("\n").substring(0, 1024), inline: false });
      }
    }
    if (kickedList.length > 0) {
      embed.addFields({ name: "❌ Kicked", value: kickedList.join("\n").substring(0, 1024), inline: false });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (err) {
    console.error("❌ listplayers button error:", err);
    await interaction.reply({ content: "❌ Failed to list players.", ephemeral: true });
  }
}

// ─── Kick modal trigger ───────────────────────────────────────────────────────
async function showKickModal(interaction: ButtonInteraction) {
  const tournamentId = interaction.customId.replace("kick_", "");
  const modal = new ModalBuilder()
    .setCustomId(`kick_modal_${tournamentId}`)
    .setTitle("🚫 Kick / Unban Player");

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder().setCustomId("userid").setLabel("User ID")
        .setStyle(TextInputStyle.Short).setPlaceholder("e.g. 123456789").setRequired(true)
    )
  );
  await interaction.showModal(modal);
}

// ─── Cancel scheduled tournament ─────────────────────────────────────────────
async function cancelScheduled(interaction: ButtonInteraction) {
  const scheduleId = interaction.customId.replace("cancel_schedule_", "");
  const item = scheduledTournaments.get(scheduleId);

  if (!item) {
    await interaction.reply({ content: "❌ Schedule not found (already created or cancelled).", ephemeral: true });
    return;
  }

  const isAuthorized = AUTHORIZED_USERS.includes(interaction.user.id) || item.createdBy === interaction.user.id;
  if (!isAuthorized) {
    await interaction.reply({ content: "❌ Only the creator can cancel this schedule.", ephemeral: true });
    return;
  }

  clearTimeout(item.timer);
  scheduledTournaments.delete(scheduleId);

  await interaction.reply({
    content: `✅ Schedule **${item.config.name}** (\`${scheduleId}\`) cancelled.`,
    ephemeral: true,
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  MODAL HANDLER
// ════════════════════════════════════════════════════════════════════════════

async function handleModal(interaction: ModalSubmitInteraction) {
  if (interaction.customId.startsWith("modal_edit_")) {
    await updateTournamentFromModal(interaction);
  } else if (interaction.customId.startsWith("kick_modal_")) {
    await kickPlayerFromModal(interaction);
  }
}

async function updateTournamentFromModal(interaction: ModalSubmitInteraction) {
  const tournamentId = interaction.customId.replace("modal_edit_", "");
  try {
    const tournament = await Tournament.findOne({ TournamentId: tournamentId });
    if (!tournament) { await interaction.reply({ content: "❌ Tournament not found.", ephemeral: true }); return; }

    const newName       = interaction.fields.getTextInputValue("tournament_name");
    const newColor      = interaction.fields.getTextInputValue("tournament_color");
    const newMaxInvites = parseInt(interaction.fields.getTextInputValue("max_invites"));
    const feeValue      = interaction.fields.getTextInputValue("entry_fee");
    const prizesValue   = interaction.fields.getTextInputValue("prizes");

    if (!newName.trim()) { await interaction.reply({ content: "❌ Name cannot be empty.", ephemeral: true }); return; }

    const colorHex = newColor.startsWith("#") ? newColor : `#${newColor}`;
    if (isNaN(parseInt(colorHex.replace("#", ""), 16))) {
      await interaction.reply({ content: `❌ Invalid color: **${newColor}**`, ephemeral: true }); return;
    }
    if (isNaN(newMaxInvites) || newMaxInvites < 2) {
      await interaction.reply({ content: "❌ Invalid max slots (minimum: 2).", ephemeral: true }); return;
    }
    if (newMaxInvites < tournament.CurrentInvites) {
      await interaction.reply({ content: `❌ Cannot reduce slots below current players (${tournament.CurrentInvites}).`, ephemeral: true }); return;
    }

    tournament.TournamentName  = newName;
    tournament.TournamentColor = colorHex;
    tournament.MaxInvites      = newMaxInvites;

    if (feeValue.trim()) {
      const fee = parseInt(feeValue);
      if (!isNaN(fee) && fee >= 0) tournament.EntryFee = fee;
    }

    tournament.Prizes = prizesValue.trim() ? parsePrizes(prizesValue) : undefined;

    await tournament.save();
    await interaction.reply({
      content: `✅ Tournament **${tournament.TournamentName}** (\`${tournamentId}\`) updated!`,
      ephemeral: true,
    });
  } catch (error) {
    console.error("❌ Modal edit error:", error);
    await interaction.reply({ content: "❌ Error updating tournament.", ephemeral: true });
  }
}

async function kickPlayerFromModal(interaction: ModalSubmitInteraction) {
  const tournamentId = interaction.customId.replace("kick_modal_", "");
  try {
    const userId = interaction.fields.getTextInputValue("userid").trim();
    if (!userId) { await interaction.reply({ content: "❌ Invalid user ID.", ephemeral: true }); return; }

    const user = await BackboneUser.findOne({ UserId: userId });
    if (!user) { await interaction.reply({ content: `❌ User \`${userId}\` not found.`, ephemeral: true }); return; }

    const tournamentData = user.Tournaments?.get(tournamentId);
    if (!tournamentData || !tournamentData.SignedUp) {
      await interaction.reply({ content: `❌ User \`${userId}\` is not registered in this tournament.`, ephemeral: true }); return;
    }
    if (!tournamentData.PartyMembers || tournamentData.PartyMembers.length === 0) {
      await interaction.reply({ content: "❌ Party structure not found.", ephemeral: true }); return;
    }

    const currentMember   = tournamentData.PartyMembers.find((m: any) => m.UserId === userId);
    const isCurrentlyKicked = currentMember?.IsKicked || false;
    const newKickedState  = !isCurrentlyKicked;

    tournamentData.PartyMembers = tournamentData.PartyMembers.map((member: any) => {
      if (member.UserId === userId) {
        return {
          ...member,
          IsKicked: newKickedState,
          Status:   newKickedState ? TournamentUserStatus.KickedOutByAdmin : TournamentUserStatus.Confirmed,
        };
      }
      return member;
    });

    user.Tournaments.set(tournamentId, tournamentData);
    await user.save();

    const action = newKickedState ? "🚫 Kicked" : "✅ Unbanned";
    await interaction.reply({
      content: `${action}: Player \`${userId}\` (**${user.Username}**) has been **${newKickedState ? "kicked" : "unbanned"}** from the tournament.`,
      ephemeral: true,
    });
  } catch (err) {
    console.error("❌ Kick modal error:", err);
    await interaction.reply({ content: "❌ Failed to process kick/unban.", ephemeral: true });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  SELECT MENU HANDLER
// ════════════════════════════════════════════════════════════════════════════

async function handleSelectMenu(interaction: StringSelectMenuInteraction) {
  if (interaction.customId === "select_tournament") {
    await showTournamentActions(interaction, interaction.values[0]);
  } else if (interaction.customId === "select_match_winner") {
    await processMatchWinner(interaction);
  }
}

async function showTournamentActions(interaction: StringSelectMenuInteraction, tournamentId: string) {
  try {
    const tournament = await Tournament.findOne({ TournamentId: tournamentId });
    if (!tournament) { await interaction.reply({ content: "❌ Tournament not found.", ephemeral: true }); return; }

    const embed = buildTournamentEmbed(tournament.toObject());

    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`delete_${tournamentId}`).setLabel("🗑️ Delete").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`edit_${tournamentId}`).setLabel("✏️ Edit").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`listplayers_${tournamentId}`).setLabel("👥 Players").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`kick_${tournamentId}`).setLabel("🚫 Kick / Unban").setStyle(ButtonStyle.Danger),
    );

    await interaction.reply({ embeds: [embed], components: [actionRow], ephemeral: true });
  } catch (error) {
    console.error("❌ showTournamentActions error:", error);
    await interaction.reply({ content: "❌ Error loading tournament actions.", ephemeral: true });
  }
}

// ─── Pick winner via select menu ──────────────────────────────────────────────
async function showPickWinnerMenu(interaction: ButtonInteraction) {
  const matchId = interaction.customId.replace("pick_winner_", "");
  try {
    const match = await Match.findOne({ id: matchId });
    if (!match) { await interaction.reply({ content: `❌ Match \`${matchId}\` not found.`, ephemeral: true }); return; }

    if (match.status !== TournamentMatchStatus.GameInProgress && match.status !== TournamentMatchStatus.GameReady) {
      await interaction.reply({
        content: `❌ This match is not ongoing (status: ${MATCH_STATUS_LABELS[match.status] || match.status}).`,
        ephemeral: true,
      });
      return;
    }

    const teamsMap = new Map<string, string[]>();
    for (const u of match.users) {
      const tid = u["@team-id"];
      if (!teamsMap.has(tid)) teamsMap.set(tid, []);
      teamsMap.get(tid)!.push(u["@user-id"]);
    }

    const teamIds = Array.from(teamsMap.keys());
    if (teamIds.length < 2) { await interaction.reply({ content: "❌ Not enough teams.", ephemeral: true }); return; }

    const options = teamIds.map((tid, i) => {
      const members = teamsMap.get(tid)!;
      return {
        label:       `Team ${i + 1} — ${members.slice(0, 3).join(", ")}${members.length > 3 ? "..." : ""}`.substring(0, 100),
        description: `Team ID: ${tid}`.substring(0, 100),
        value:       `${matchId}||${tid}`,
      };
    });

    const select = new StringSelectMenuBuilder()
      .setCustomId("select_match_winner")
      .setPlaceholder("🏆 Select the winning team...")
      .addOptions(options);

    const embed = new EmbedBuilder()
      .setColor(0xf0a500)
      .setTitle(`Decide Winner — Match \`${matchId}\``)
      .setDescription(`Tournament: \`${match.tournamentid}\` | Round: ${match.roundid}`)
      .addFields({ name: "Teams", value: buildTeamDisplay(match.users), inline: false });

    await interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  } catch (err) {
    console.error("❌ showPickWinnerMenu error:", err);
    await interaction.reply({ content: "❌ Error loading match.", ephemeral: true });
  }
}

async function processMatchWinner(interaction: StringSelectMenuInteraction) {
  const [matchId, winningTeamId] = interaction.values[0].split("||");
  try {
    await interaction.deferReply({ ephemeral: true });

    const match = await Match.findOne({ id: matchId });
    if (!match) { await interaction.editReply({ content: `❌ Match \`${matchId}\` not found.` }); return; }

    if (match.status !== TournamentMatchStatus.GameInProgress && match.status !== TournamentMatchStatus.GameReady) {
      await interaction.editReply({ content: `❌ Match can no longer be edited (status: ${MATCH_STATUS_LABELS[match.status] || match.status}).` });
      return;
    }

    const tournament = await Tournament.findOne({ TournamentId: match.tournamentid });
    if (!tournament) { await interaction.editReply({ content: "❌ Tournament not found." }); return; }

    const teamsMap = new Map<string, any[]>();
    for (const u of match.users) {
      const tid = u["@team-id"];
      if (!teamsMap.has(tid)) teamsMap.set(tid, []);
      teamsMap.get(tid)!.push(u);
    }

    const teamIds     = Array.from(teamsMap.keys());
    const sortedTeams = [winningTeamId, ...teamIds.filter((t) => t !== winningTeamId)];

    for (const matchUser of match.users) {
      const isWinner = matchUser["@team-id"] === winningTeamId;
      const posIndex = sortedTeams.indexOf(matchUser["@team-id"]);
      matchUser["@match-winner"] = isWinner ? "1" : "0";
      matchUser["@match-points"] = isWinner ? "1" : "0";
      matchUser["@team-score"]   = (teamIds.length - posIndex).toString();
    }

    const updateResult = await Match.updateOne(
      { id: matchId },
      { $set: { status: TournamentMatchStatus.GameFinished, users: match.users } }
    );

    if (updateResult.modifiedCount === 0) {
      await interaction.editReply({ content: "⚠️ Match was not updated (already processed?)." });
      return;
    }

    const winningUserIds = match.users.filter((u: any) => u["@team-id"] === winningTeamId).map((u: any) => u["@user-id"]);
    const allUserIds     = match.users.map((u: any) => u["@user-id"]);
    const allUsers       = await BackboneUser.find({ UserId: { $in: allUserIds } });
    const winningUsers   = allUsers.filter((u) => winningUserIds.includes(u.UserId));

    for (const winner of winningUsers) {
      await Qualify(winner, tournament as any);
    }

    const winnerMembers = teamsMap.get(winningTeamId) || [];
    const winnerDisplay = winnerMembers.map((u: any) => `\`${u["@user-id"]}\``).join(", ");

    const embed = new EmbedBuilder()
      .setColor(0x2ad100)
      .setTitle("🏆 Winner Decided")
      .setDescription(`Match \`${matchId}\` concluded manually.`)
      .addFields(
        { name: "🥇 Winning Team", value: `Team ID: \`${winningTeamId}\`\n${winnerDisplay}`, inline: false },
        { name: "⚔️ Tournament",  value: tournament.TournamentName,                           inline: true  },
        { name: "📋 Round",       value: match.roundid.toString(),                             inline: true  },
        { name: "👤 Decided by",  value: `<@${interaction.user.id}>`,                        inline: true  },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("❌ processMatchWinner error:", err);
    try { await interaction.editReply({ content: "❌ Error processing winner." }); } catch {}
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /top — أفضل اللاعبين
// ════════════════════════════════════════════════════════════════════════════

async function topCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: false }); // عام — يشوفه الكل
  try {
    const limit = Math.min(interaction.options.getInteger("limit") ?? 10, 25);

    const players = await BackboneUser.find({ TournamentsWon: { $gt: 0 } })
      .sort({ TournamentsWon: -1 })
      .limit(limit)
      .select("Username UserId TournamentsWon")
      .lean();

    if (players.length === 0) {
      await interaction.editReply({ content: "📭 No players with tournament wins yet." });
      return;
    }

    const medals = ["🥇", "🥈", "🥉"];
    const lines  = players.map((p, i) => {
      const medal = medals[i] || `**${i + 1}.**`;
      const wins  = (p as any).TournamentsWon;
      const trophy = wins >= 10 ? " 👑" : wins >= 5 ? " ⭐" : "";
      return `${medal} **${(p as any).Username}**${trophy} — ${wins} 🏆`;
    });

    const embed = new EmbedBuilder()
      .setTitle("🏅 Tournament Leaderboard")
      .setColor(0xffd700)
      .setDescription(lines.join("\n"))
      .setFooter({ text: `Top ${players.length} players by tournament wins` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("top error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /resetplayer — إعادة تعيين بيانات لاعب في بطولة
// ════════════════════════════════════════════════════════════════════════════

async function resetPlayerCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id        = interaction.options.getString("id", true);
    const playerArg = interaction.options.getString("player", true).trim();

    const tour = await Tournament.findOne({ TournamentId: id }).lean();
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });

    const player = await BackboneUser.findOne({
      $or: [{ UserId: playerArg }, { Username: { $regex: `^${playerArg}$`, $options: "i" } }],
    });
    if (!player) return void await interaction.editReply({ content: `❌ Player \`${playerArg}\` not found.` });

    const tid      = id.toString();
    const tourData = player.Tournaments.get(tid);
    if (!tourData) {
      return void await interaction.editReply({ content: `❌ Player **${player.Username}** has no data in tournament \`${id}\`.` });
    }

    // تأكيد قبل الإعادة
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`reset_confirm_${tid}_${player.UserId}`)
        .setLabel("✅ Yes, Reset")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("reset_cancel")
        .setLabel("✖️ Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    const confirmEmbed = new EmbedBuilder()
      .setTitle("⚠️ Confirm Reset")
      .setDescription(
        `Reset **${player.Username}** (\`${player.UserId}\`) in tournament \`${id}\`?\n\n` +
        `This will clear their match history, position, and KnockedOut status.\n` +
        `They will remain signed up.`
      )
      .setColor(0xff9900);

    await interaction.editReply({ embeds: [confirmEmbed], components: [confirmRow] });

    const reply     = await interaction.fetchReply();
    const collector = reply.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30_000 });

    collector.on("collect", async (btn: ButtonInteraction) => {
      if (btn.user.id !== interaction.user.id) {
        await btn.reply({ content: "❌ Only the command user can confirm.", ephemeral: true });
        return;
      }

      if (btn.customId.startsWith("reset_confirm_")) {
        const parts = btn.customId.split("_");
        const tId   = parts[2];
        const uId   = parts[3];

        const freshPlayer = await BackboneUser.findOne({ UserId: uId });
        if (!freshPlayer) { await btn.update({ content: "❌ Player not found.", embeds: [], components: [] }); return; }

        const data = freshPlayer.Tournaments.get(tId);
        if (data) {
          data.UserMatch   = null;
          data.UserMatches = [];
          data.UserPosition = [{
            groupid: 0, matchloses: 0,
            phaseid: (tour as any).CurrentPhaseId || 1,
            rankposition: 0, sameposition: 0,
            totalpoints: 0, totalrounds: 0,
          }];
          data.KnockedOut  = false;
          data.FinalPlace  = 0;
          freshPlayer.markModified(`Tournaments.${tId}`);
          await freshPlayer.save();
        }

        await btn.update({
          embeds: [
            new EmbedBuilder()
              .setTitle("🔄 Player Reset")
              .setDescription(`**${freshPlayer.Username}** has been reset in tournament \`${tId}\`.`)
              .setColor(0x43b581)
              .setTimestamp(),
          ],
          components: [],
        });
      } else {
        await btn.update({
          embeds: [new EmbedBuilder().setTitle("✖️ Cancelled").setColor(0x5865f2)],
          components: [],
        });
      }
      collector.stop();
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        try { await interaction.editReply({ content: "⏱️ Timed out.", embeds: [], components: [] }); } catch {}
      }
    });
  } catch (err) {
    console.error("resetplayer error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /extend — تمديد وقت بداية البطولة
// ════════════════════════════════════════════════════════════════════════════

async function extendCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id      = interaction.options.getString("id", true);
    const minutes = interaction.options.getInteger("minutes", true);

    const tour = await Tournament.findOne({ TournamentId: id });
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });

    if (tour.Status === TournamentStatus.Finished || tour.Status === TournamentStatus.Canceled) {
      return void await interaction.editReply({ content: `❌ Cannot extend a finished or canceled tournament.` });
    }

    const oldStart    = new Date(tour.StartTime);
    const newStart    = new Date(oldStart.getTime() + minutes * 60 * 1000);
    const oldSignup   = new Date(tour.SignupStart);
    const newSignup   = new Date(oldSignup.getTime() + minutes * 60 * 1000);

    await Tournament.updateOne(
      { TournamentId: id },
      { $set: { StartTime: newStart, SignupStart: newSignup } }
    );

    const embed = new EmbedBuilder()
      .setTitle("⏰ Tournament Extended")
      .setColor(0x5865f2)
      .setDescription(`**${tour.TournamentName}** (\`${id}\`) extended by **${minutes} minute(s)**.`)
      .addFields(
        { name: "Old Start",  value: `<t:${Math.floor(oldStart.getTime() / 1000)}:F>`,  inline: true },
        { name: "New Start",  value: `<t:${Math.floor(newStart.getTime() / 1000)}:F>`,  inline: true },
        { name: "Starts In",  value: `<t:${Math.floor(newStart.getTime() / 1000)}:R>`,  inline: false },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("extend error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /duplicate — نسخ بطولة موجودة
// ════════════════════════════════════════════════════════════════════════════

async function duplicateCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id           = interaction.options.getString("id", true);
    const startMinutes = interaction.options.getInteger("start", true);
    const signupMinutes = interaction.options.getInteger("signup") ?? 0;
    const newName      = interaction.options.getString("name");

    const original = await Tournament.findOne({ TournamentId: id }).lean();
    if (!original) {
      return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });
    }

    const now         = new Date();
    const startTime   = new Date(now.getTime() + startMinutes * 60 * 1000);
    const signupStart = new Date(now.getTime() + signupMinutes * 60 * 1000);
    const newId       = now.getTime().toString();

    const { CreateTournament } = await import("./Database");
    const { GeneratePrizepoolId } = await import("../Modules/Extensions");

    await CreateTournament({
      CurrentInvites:    0,
      MaxInvites:        (original as any).MaxInvites,
      TournamentId:      newId,
      TournamentName:    newName || (original as any).TournamentName,
      TournamentImage:   (original as any).TournamentImage,
      TournamentColor:   (original as any).TournamentColor,
      StartTime:         startTime,
      SignupStart:       signupStart,
      EntryFee:          (original as any).EntryFee,
      PrizepoolId:       GeneratePrizepoolId().toString(),
      PartySize:         (original as any).PartySize,
      Status:            1,
      TournamentType:    (original as any).TournamentType,
      Phases:            (original as any).Phases,
      Region:            (original as any).Region,
      RoundCount:        (original as any).RoundCount,
      CurrentPhaseId:    0,
      Properties: {
        IsInvitationOnly: (original as any).Properties?.IsInvitationOnly ?? false,
        InvitedIds:       (original as any).Properties?.InvitedIds ?? [],
        DisabledEmotes:   (original as any).Properties?.DisabledEmotes ?? [],
        AdminIds:         (original as any).Properties?.AdminIds ?? [],
        StreamURL:        (original as any).Properties?.StreamURL ?? "",
      },
      MinPlayersPerMatch: (original as any).MinPlayersPerMatch,
      MaxPlayersPerMatch: (original as any).MaxPlayersPerMatch,
      Prizes:             (original as any).Prizes ?? [],
    });

    const colorVal = parseInt(((original as any).TournamentColor || "#2ad100").replace("#", ""), 16);
    const embed = new EmbedBuilder()
      .setColor(isNaN(colorVal) ? 0x2ad100 : colorVal)
      .setTitle("📋 Tournament Duplicated!")
      .addFields(
        { name: "Original",  value: `\`${id}\``,                                                    inline: true  },
        { name: "New ID",    value: `\`${newId}\``,                                                  inline: true  },
        { name: "Name",      value: newName || (original as any).TournamentName,                     inline: false },
        { name: "Sign-ups",  value: `<t:${Math.floor(signupStart.getTime() / 1000)}:R>`,             inline: true  },
        { name: "Start",     value: `<t:${Math.floor(startTime.getTime() / 1000)}:R>`,               inline: true  },
        { name: "Region",    value: ((original as any).Region || "").toUpperCase(),                  inline: true  },
        { name: "Mode",      value: getModeLabel((original as any).PartySize || 1),                  inline: true  },
        { name: "Slots",     value: `${(original as any).MaxInvites}`,                               inline: true  },
      )
      .setTimestamp();

    if ((original as any).TournamentImage) embed.setThumbnail((original as any).TournamentImage);

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("duplicate error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /setprizes — تعيين الجوائز لبطولة
// ════════════════════════════════════════════════════════════════════════════

async function setPrizesCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id          = interaction.options.getString("id", true);
    const prizesInput = interaction.options.getString("prizes", true).trim();

    const tour = await Tournament.findOne({ TournamentId: id });
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });

    const isAdmin = AUTHORIZED_USERS.includes(interaction.user.id) ||
                    tour.Properties.AdminIds.includes(interaction.user.id);
    if (!isAdmin) return void await interaction.editReply({ content: "❌ You don't have permission." });

    let prizes: Array<{ position: number; amount: number }> = [];
    let description = "";

    if (prizesInput.toLowerCase() === "clear") {
      prizes = [];
      description = "✅ All prizes have been **cleared**.";
    } else {
      prizes = parsePrizes(prizesInput);
      if (prizes.length === 0) {
        return void await interaction.editReply({
          content: "❌ Invalid format. Use: `1:1000,2:500,3:250` (position:diamonds)",
        });
      }
      // ترتيب الجوائز حسب المركز
      prizes.sort((a, b) => a.position - b.position);
      description = prizes
        .map((p) => {
          const medal = p.position === 1 ? "🥇" : p.position === 2 ? "🥈" : p.position === 3 ? "🥉" : `**#${p.position}**`;
          return `${medal} → **${p.amount.toLocaleString()} 💎**`;
        })
        .join("\n");
    }

    await Tournament.updateOne({ TournamentId: id }, { $set: { Prizes: prizes } });

    const colorVal = parseInt((tour.TournamentColor || "#ffd700").replace("#", ""), 16);
    const embed = new EmbedBuilder()
      .setColor(isNaN(colorVal) ? 0xffd700 : colorVal)
      .setTitle("🏆 Prizes Updated!")
      .setDescription(`**${tour.TournamentName}** (\`${id}\`)\n\n${description}`)
      .setFooter({ text: prizes.length > 0 ? `${prizes.length} prize tier(s) set` : "No prizes" })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.error("setprizes error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /schedule-list — عرض البطولات المجدولة
// ════════════════════════════════════════════════════════════════════════════

async function scheduleListCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const pending = Array.from(scheduledTournaments.values());

    if (pending.length === 0) {
      await interaction.editReply({ content: "📭 No scheduled tournaments pending." });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`📅 Scheduled Tournaments (${pending.length})`)
      .setColor(0x5865f2)
      .setTimestamp();

    for (const item of pending) {
      const ts = Math.floor(item.scheduledFor.getTime() / 1000);
      embed.addFields({
        name:  `📌 ${item.config.name}`,
        value: [
          `🆔 \`${item.scheduleId}\``,
          `🕐 <t:${ts}:F> (<t:${ts}:R>)`,
          `🌍 ${String(item.config.region).toUpperCase()} | ⚔️ ${getModeLabel(item.config.partySize)} | 🗺️ ${item.config.selectedMap}`,
          `👤 Created by <@${item.createdBy}>`,
        ].join("\n"),
        inline: false,
      });
    }

    // أزرار إلغاء لكل بطولة مجدولة
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (const item of pending.slice(0, 5)) {
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`cancel_schedule_${item.scheduleId}`)
          .setLabel(`❌ Cancel: ${item.config.name.substring(0, 40)}`)
          .setStyle(ButtonStyle.Danger)
      );
      rows.push(row);
    }

    await interaction.editReply({ embeds: [embed], components: rows });
  } catch (err) {
    console.error("schedule-list error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /announce — إعادة إرسال الـ webhook لبطولة موجودة
// ════════════════════════════════════════════════════════════════════════════

async function announceCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const id   = interaction.options.getString("id", true);
    const tour = await Tournament.findOne({ TournamentId: id }).lean();
    if (!tour) return void await interaction.editReply({ content: `❌ Tournament \`${id}\` not found.` });

    const webhookUri = process.env.WEBHOOK_URI;
    if (!webhookUri) {
      return void await interaction.editReply({ content: "❌ WEBHOOK_URI is not set in .env" });
    }

    // بناء الـ embed للإعلان
    const colorHex   = (tour as any).TournamentColor?.replace("#", "") || "2ad100";
    const colorValue = parseInt(colorHex.substring(0, 6), 16);
    const startTs    = Math.floor(new Date((tour as any).StartTime).getTime() / 1000);
    const signupTs   = Math.floor(new Date((tour as any).SignupStart).getTime() / 1000);
    const partySize  = (tour as any).PartySize || 1;
    const maxPlayers = (tour as any).MaxInvites || 0;
    const isFFA      = partySize === 1 && (tour as any).MaxPlayersPerMatch > 2;
    const modeText   = isFFA
      ? Array((tour as any).MaxPlayersPerMatch).fill("1").join("v")
      : `${partySize}v${partySize}`;

    const playerCount = await BackboneUser.countDocuments({
      [`Tournaments.${id}`]: { $exists: true },
      [`Tournaments.${id}.SignedUp`]: true,
    });

    // بناء قسم الجوائز
    let prizesText = "";
    const prizes = Array.isArray((tour as any).Prizes) ? (tour as any).Prizes : [];
    if (prizes.length > 0) {
      prizesText = "\n---\n🏆 Prizes\n";
      prizes.forEach((p: any) => {
        const medal = p.position === 1 ? "🥇" : p.position === 2 ? "🥈" : p.position === 3 ? "🥉" : `#${p.position}`;
        prizesText += `> ${medal} **${Number(p.amount).toLocaleString()} 💎**\n`;
      });
    }

    const payload = {
      content: "<@&1502000025218187447>",
      embeds: [
        {
          title: "",
          color: isNaN(colorValue) ? 0x2ad100 : colorValue,
          thumbnail: { url: (tour as any).TournamentImage || "https://cdn.stumblepriv.com/Emotes/Emote007_Crown.png" },
          description:
            `# 🏆 ${(tour as any).TournamentName.toLowerCase()}\n\n` +
            `> 🌍 Region: **${((tour as any).Region || "").toUpperCase()}**\n` +
            `> ⚔️ Mode: **${modeText}**\n` +
            `> 👥 Players: **${playerCount}/${maxPlayers}**\n\n` +
            `---\n` +
            `> 📋 Sign-ups Open\n> <t:${signupTs}:R> (**<t:${signupTs}:f>**)\n` +
            `> 🚀 Start Time\n> <t:${startTs}:R> (**<t:${startTs}:f>**)\n` +
            prizesText,
          footer: { text: `Tournament ID: ${id}` },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const webhookUrl = webhookUri.startsWith("https://discord.com/api/webhooks/")
      ? webhookUri.replace("https://discord.com/api/webhooks/", "https://discord.com/api/v10/webhooks/")
      : webhookUri;

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      return void await interaction.editReply({ content: `❌ Webhook failed (${response.status}): ${errText}` });
    }

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle("📢 Announcement Sent!")
          .setColor(0x43b581)
          .setDescription(`Tournament **${(tour as any).TournamentName}** (\`${id}\`) announced successfully.`)
          .setTimestamp(),
      ],
    });
  } catch (err) {
    console.error("announce error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  /leaderboard — إرسال الـ leaderboard يدوياً
// ════════════════════════════════════════════════════════════════════════════

async function leaderboardCommand(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const { SendAllTimeLeaderboard } = await import("./HallOfFame");
    await SendAllTimeLeaderboard();
    await interaction.editReply({ content: "✅ All-Time Leaderboard sent to the webhook channel!" });
  } catch (err) {
    console.error("leaderboard error:", err);
    await interaction.editReply({ content: `❌ Error: \`${err}\`` });
  }
}

export default Bot;
