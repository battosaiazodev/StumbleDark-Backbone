import { BackboneUser } from "../Models/BackboneUser";
import { Tournament, TournamentInput } from "../Models/Tournament";
import { v4 as uuidv4 } from "uuid";
import { msg } from "../Modules/Logger";
import { GenerateInviteId } from "../Modules/Extensions";
import { TournamentPhaseType, Scenes, Emotes } from "../Backbone/Config";

const WEBHOOK_URI = process.env.WEBHOOK_URI || "";

function getMapFriendlyName(sceneId: string): string {
  const mapName = Object.keys(Scenes).find(
    (key) => Scenes[key as keyof typeof Scenes] === sceneId
  );
  return mapName || sceneId;
}

// ─── تحويل DisabledEmotes لنص مقروء ──────────────────────────────────────────
function getEmoteRestrictionText(disabledEmotes: number[]): string {
  if (!disabledEmotes || disabledEmotes.length === 0) return "All Allowed <:Tick:1527264315948667002>";

  // الـ presets الخاصة
  const presetMap: Record<number, string> = {
    [-2]: "Punch Only <:FirePunch:1526711682624393246> <:Punch:1526710124448841820>",
    [-3]: "Punch & Kick Only <:FirePunch:1526711682624393246> <:Punch:1526710124448841820> <:WaterKick:1526710886058819777> <:Kick:1526710865502408844>",
    [-4]: "Banana Only <:GoldenBanana:1526711861414985851> <:Banana:1526711841785643231>",
    [-5]: "Hug Only <:ElectricHug:1526711094888890458> <:Hug:1526711037057826838>",
    [-1]: "Special Emotes Only <:DadoSg:1531314826763305082>",
    [0]:  "No Emotes <:Cross:1526712034459390154>",
  };

  // تحقق إذا كل الـ emotes هي preset واحد
  if (disabledEmotes.length === 1 && presetMap[disabledEmotes[0]] !== undefined) {
    return presetMap[disabledEmotes[0]];
  }

  // إذا في preset ضمن القائمة
  for (const [preset, label] of Object.entries(presetMap)) {
    if (disabledEmotes.includes(Number(preset))) {
      return label;
    }
  }

  // أسماء الـ emotes العادية
  const names = disabledEmotes
    .slice(0, 5)
    .map((id) => {
      const name = Object.keys(Emotes).find(
        (k) => isNaN(Number(k)) && (Emotes[k as keyof typeof Emotes] as number) === id
      );
      return name || `ID:${id}`;
    });

  return names.join(", ") + (disabledEmotes.length > 5 ? ` +${disabledEmotes.length - 5} more` : "");
}

// ─── بناء الـ embed payload ────────────────────────────────────────────────────
function buildWebhookPayload(opts: {
  tournament: any;
  decimalColor: number;
  modeText: string;
  signupTimestamp: number;
  startTimestamp: number;
  signedUpCount: number;
  maxPlayers: number;
  teamCount: number;
  maxTeams: number;
  phasesContent: string;
  prizesContent: string;
  emoteText?: string;
}): object {
  const {
    tournament, decimalColor, modeText,
    signupTimestamp, startTimestamp,
    signedUpCount, maxPlayers, teamCount, maxTeams,
    phasesContent, prizesContent,
    emoteText,
  } = opts;

  const emoteSection = emoteText
    ? `<:icons_text1:1503943667742937108> Emotes: **${emoteText}**\n`
    : "";

  return {
    content: "<@&1527263484058927124>",
    embeds: [
      {
        title: "",
        color: decimalColor,
        thumbnail: {
          url: tournament.TournamentImage || "https://cdn.stumblepriv.com/Emotes/Emote007_Crown.png",
        },
        description:
          `# <:trophy:1503930219784835162> ${tournament.TournamentName.toLowerCase()}\n\n` +
          `<:icons_text1:1503943667742937108> Region: **${tournament.Region || "North America"}**\n` +
          `<:icons_text1:1503943667742937108> Mode: **${modeText}**\n` +
          emoteSection +
          `\n--- \n` +
          `<:dd:1503941939572248616> Signed-Ups\n` +
          `<:icons_text1:1503943667742937108> **${signedUpCount}/${maxPlayers}** — (${teamCount}/${maxTeams} Teams)\n` +
          `<:gg:1503942388899516598> Sign-ups Open\n` +
          `<:icons_text1:1503943667742937108> <t:${signupTimestamp}:R> (**<t:${signupTimestamp}:f>**)\n` +
          `<:gg:1503942388899516598> Start Time\n` +
          `<:icons_text1:1503943667742937108> <t:${startTimestamp}:R> (**<t:${startTimestamp}:f>**)\n\n` +
          `--- \n` +
          `<:spr_icon_button_leaderboard:1503930356783513631> Phases\n` +
          phasesContent +
          prizesContent,
        footer: { text: "Tournament System" },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

// ─── بناء محتوى الـ embed (مشترك بين الإرسال والتحديث) ───────────────────────
async function buildEmbedContent(tournament: any) {
  const hexColor    = tournament.TournamentColor?.replace("#", "") || "ff00ff";
  const decimalColor = parseInt(hexColor.substring(0, 6), 16);

  const isFFA    = tournament.PartySize === 1 && tournament.MaxPlayersPerMatch > 2;
  const modeText = isFFA
    ? Array(tournament.MaxPlayersPerMatch).fill("1").join("v")
    : `${tournament.PartySize}v${tournament.PartySize}`;

  const startTimestamp  = Math.floor(new Date(tournament.StartTime).getTime() / 1000);
  const signupTimestamp = Math.floor(new Date(tournament.SignupStart).getTime() / 1000);

  const signedUpCount = await BackboneUser.countDocuments({
    [`Tournaments.${tournament.TournamentId}`]: { $exists: true },
    [`Tournaments.${tournament.TournamentId}.SignedUp`]: true,
  });
  const maxPlayers = tournament.MaxInvites || 256;
  const partySize  = tournament.PartySize || 1;
  const teamCount  = Math.ceil(signedUpCount / partySize);
  const maxTeams   = Math.ceil(maxPlayers / partySize);

  // ─── نص الـ emotes ────────────────────────────────────────────────────
  const disabledEmotes: number[] = Array.isArray(tournament.Properties?.DisabledEmotes)
    ? tournament.Properties.DisabledEmotes
    : [];
  const emoteText = getEmoteRestrictionText(disabledEmotes);

  let phasesContent = "";
  if (tournament.Phases && tournament.Phases.length > 0) {
    tournament.Phases.forEach((phase: any, index: number) => {
      const phaseTypeName =
        phase.PhaseType === TournamentPhaseType.SingleEliminationBracket
          ? "Bracket (Single Elimination)"
          : phase.PhaseType === TournamentPhaseType.RoundRobin
          ? "Round Robin"
          : phase.PhaseType === TournamentPhaseType.Arena
          ? "Arena"
          : "Unknown";
      phasesContent += `<:icons_text1:1503943667742937108> Phase ${index + 1}: **${phaseTypeName}**\n`;
      if (phase.Maps && phase.Maps.length > 0) {
        phase.Maps.forEach((sceneId: string, rIndex: number) => {
          phasesContent += `<:icons_text1:1503943667742937108> Round ${rIndex + 1}: **${getMapFriendlyName(sceneId)}**\n`;
        });
      }
    });
  }

  let prizesContent = "";
  if (Array.isArray(tournament.Prizes) && tournament.Prizes.length > 0) {
    prizesContent = "\n--- \n🏆 Prizes\n";
    tournament.Prizes.forEach((prize: any) => {
      const medal = prize.position === 1 ? "<:GoldenMedal:1526712399779070032>" : prize.position === 2 ? "<:SilverMedal:1526716858441531472>" : prize.position === 3 ? "<:BronzeMedal:1526716882403721430>" : `#${prize.position}`;
      prizesContent += `<:icons_text1:1503943667742937108> ${medal} **${Number(prize.amount).toLocaleString()} <:PileOfGems:1526712977385066546>**\n`;
    });
  }

  return {
    payload: buildWebhookPayload({
      tournament, decimalColor, modeText,
      signupTimestamp, startTimestamp,
      signedUpCount, maxPlayers, teamCount, maxTeams,
      phasesContent, prizesContent,
      emoteText,
    }),
    signedUpCount,
    maxPlayers,
  };
}

// ─── إرسال webhook جديد ويرجع الـ message ID ─────────────────────────────────
async function SendWebhook(tournament: any): Promise<string | null> {
  if (!WEBHOOK_URI) return null;

  try {
    const { payload } = await buildEmbedContent(tournament);

    const webhookUrl = WEBHOOK_URI.startsWith("https://discord.com/api/webhooks/")
      ? WEBHOOK_URI.replace("https://discord.com/api/webhooks/", "https://discord.com/api/v10/webhooks/")
      : WEBHOOK_URI;

    // ?wait=true يخلي Discord يرجع الـ message object مع الـ ID
    const response = await fetch(`${webhookUrl}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Webhook failed with status ${response.status}: ${await response.text()}`);
      return null;
    }

    const data = await response.json() as { id?: string };
    return data.id || null;

  } catch (err) {
    console.error("Webhook failed:", err);
    return null;
  }
}

// ─── تحديث رسالة الـ webhook بعداد التسجيل الجديد ────────────────────────────
export async function UpdateWebhookSignupCount(tournamentId: string): Promise<void> {
  if (!WEBHOOK_URI) return;

  try {
    const tournament = await Tournament.findOne({ TournamentId: tournamentId }).lean();
    if (!tournament || !(tournament as any).WebhookMessageId) return;

    const messageId = (tournament as any).WebhookMessageId as string;
    const { payload } = await buildEmbedContent(tournament);

    const webhookUrl = WEBHOOK_URI.startsWith("https://discord.com/api/webhooks/")
      ? WEBHOOK_URI.replace("https://discord.com/api/webhooks/", "https://discord.com/api/v10/webhooks/")
      : WEBHOOK_URI;

    // PATCH لتعديل الرسالة الموجودة
    const response = await fetch(`${webhookUrl}/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Webhook update failed (${response.status}): ${await response.text()}`);
    }
  } catch (err) {
    console.error("Webhook update failed:", err);
  }
}

// ─── إنشاء بطولة جديدة ────────────────────────────────────────────────────────
export async function CreateTournament(tournamentData: TournamentInput) {
  const signupStart = tournamentData.SignupStart ?? new Date(tournamentData.StartTime.getTime() - 60 * 60 * 1000);

  const tournament = new Tournament({
    ...tournamentData,
    SignupStart: signupStart,
  });

  const saved = await tournament.save();

  // إرسال الـ webhook وحفظ الـ message ID
  SendWebhook(saved)
    .then(async (messageId) => {
      if (messageId) {
        await Tournament.updateOne(
          { TournamentId: saved.TournamentId },
          { $set: { WebhookMessageId: messageId } }
        );
      }
    })
    .catch((err) => console.error("Webhook error:", err));

  return saved;
}

// ─── توليد User ID فريد ───────────────────────────────────────────────────────
async function GenerateUserId(): Promise<string> {
  const UsersCollection = BackboneUser.collection;
  let unique = false;
  let userId = "";

  while (!unique) {
    userId = Math.floor(10000 + Math.random() * 90000).toString();
    const exists = await UsersCollection.findOne({ UserId: userId });
    if (!exists) unique = true;
  }
  return userId;
}

// ─── إنشاء مستخدمين مسجلين للاختبار ─────────────────────────────────────────
export async function CreateSignedUpUser(Times: number, TournamentId: string) {
  const users = [];
  const DBTour = await Tournament.findOne({ TournamentId });

  if (!DBTour) {
    msg("Please provide a valid tournamentid :)");
    return;
  }

  const partySize = DBTour.PartySize;

  for (let i = 0; i < Times / partySize; i++) {
    const partyCode    = uuidv4();
    const partyMembers = [];
    const AcceptedAt   = new Date();

    for (let j = 0; j < partySize; j++) {
      const UserId        = await GenerateUserId();
      const Username      = `Tournament-SDK #${Math.random().toString(36).substring(2, 8)}`;
      const IsPartyLeader = j === 0;
      partyMembers.push({ UserId, Username, Status: 1, IsPartyLeader });
    }

    for (const member of partyMembers) {
      const user = new BackboneUser({
        Username: member.Username,
        UserId:   member.UserId,
        Tournaments: {
          [TournamentId]: {
            SignedUp:     true,
            InviteId:     GenerateInviteId(),
            Status:       1,
            AcceptedAt,
            PartyCode:    partyCode,
            KnockedOut:   false,
            PartyMembers: partyMembers,
            UserMatch:    null,
            UserMatches:  [],
            UserPosition: [],
            FinalPlace:   0,
          },
        },
      });
      users.push(user.save());
    }
  }

  return await Promise.all(users);
}
