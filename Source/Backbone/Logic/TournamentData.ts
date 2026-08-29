import { BackboneUser } from "../../Models/BackboneUser";
import { LPUser } from "../../Models/LPUser";
import { Match } from "../../Models/Matches";
import { Tournament } from "../../Models/Tournament";
import { TournamentStatus, TournamentUserStatus, TournamentMatchStatus, TournamentPhaseType } from "../Config";
import { GetNextPhaseStarted, GetProperties } from "../Settings/Properties";
import { GetRulesSettings, GetRoundConfigs } from "../Settings/Rules";
import { GenerateBracketMatches, GetUserMatch, Qualify, GetMatchDeadline, AssignNextMatchIfNeeded } from "./GetMatches";
import { CheckPhases } from "./Internal/Phase";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type PartyMember = {
  userId: string;
  status: number;
  checkIn: boolean;
  isPartyLeader: boolean;
  nick: string;
};

export interface PropertyData {
  "@name": string;
  "@value": string | undefined;
}

export interface RoundData {
  "@id": string;
  "@win-score": string;
  "@max-game-count": string;
  "@min-length": string;
  "@max-length": string;
  "@match-point-distribution"?: string;
}

export interface PhaseData {
  "@id": string;
  "@type": string;
  "@max-players": string;
  "@min-teams-per-match": string;
  "@max-teams-per-match": string;
  "@min-checkins-per-team": string;
  "@allow-skip": string;
  "@max-loses"?: string;
  "@game-point-distribution": string;
  "@match-point-distribution": string;
  "@allow-tiebreakers": string;
  "@score-tiebreaker-stats"?: string;
  "@fill-groups-vertically"?: string;
  "@force-unique-matches"?: string;
  "@group-count"?: string;
  "@match-point-distribution-custom"?: string;
  "@preferred-rematch-gap"?: string;
  round: RoundData[];
}

interface UserMatchResponse {
  id: string;
  secret: string;
  deadline: string;
  matchid: number;
  phaseid: number;
  groupid: number;
  roundid: number;
  playedgamecount: number;
  status: number;
  users: Array<{
    "@user-id": string;
    "@team-id": string;
    "@checked-in": string;
    "@user-score": string;
    "@team-score": string;
    "@user-points": string;
    "@team-points": string;
    "@match-points": string;
    "@match-winner": string;
    "@nick": string;
  }>;
}

interface TournamentDataItem {
  id: number | string;
  type: string | number;
  status: number;
  tournamenttime: string;
  cashStatus: number;
  cashTournament: boolean;
  season: number;
  seasonpart: number;
  invitationopens: string;
  invitationcloses: string;
  maxinvites: number;
  partysize: number;
  currentinvites: number;
  phasecount: number;
  roundcount: number;
  sponsorimage: string;
  sponsorname: string;
  currentphaseid: number;
  currentphasestarted: string | null;
  nextphase: null | string;
  name: string;
  image: null;
  icon: string | undefined | null;
  "theme-color": string | undefined | null;
  data: {
    "tournament-data": {
      "invitation-setting": Array<{
        requirements?: Array<{ "custom-requirement": Array<{ "@name": string; "@value": string }> }>;
        "entry-fee"?: Array<{ item: Array<{ "@amount": string; "@type": string; "@id": string; "@external-id": string }> }>;
      }>;
      "rules-setting": Array<{ phase: PhaseData[] }>;
      "prize-setting": Array<{
        reward: Array<{
          "@position": string;
          item: Array<{ "@amount": string; "@type": string; "@id": string; "@external-id": string }>;
        }>;
      }>;
      "property-setting": Array<{ properties: Array<{ property: PropertyData[] }> }>;
      "description-data": Array<{
        language: Array<{
          "@code": string;
          name: Array<{ "#text": Array<{ value: string }> }>;
          policy: Array<{ "@url": string }>;
          general: Array<{ "@main-icon": string | undefined; "@theme-color": string | undefined }>;
        }>;
      }>;
      "sponsor-data": Array<{ "@name": string; "@image": string }>;
      "stream-data": Array<{ "@stream-link": string }>;
      "highlights-data": Array<{ "@highlights-link": string }>;
      "winner-data"?: Array<{ user: Array<{ "@user-id": string; "@nick": string }> }>;
    };
  };
  privateCode: null;
  inviteId: string | number | null;
  inviteAceptedAt: string | null;
  inviteDeclinedAt: null;
  inviteStatus: number;
  invitePartyId: unknown;
  inviteIsPartyLeader: boolean;
  invitePartyCode: null | string;
  checkIn: boolean;
  prizeDelivered: null | boolean;
  userPlace: number;
  isAdministrator: boolean;
  openregistration?: number;
}

interface TournamentResponse {
  party: PartyMember[];
  userPosition: unknown[];
  userMatch: UserMatchResponse | null;
  userMatches: UserMatchResponse[];
  tournamentData: TournamentDataItem[];
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function ToJSON(Obj: any): any {
  if (!Obj) return Obj;
  if (Array.isArray(Obj)) return Obj.map(ToJSON);
  if (typeof Obj !== "object") return Obj;
  if (Obj.toJSON) return Obj.toJSON();
  if (Obj._doc) return ToJSON(Obj._doc);
  const Cleaned: any = {};
  for (const Key in Obj) {
    if (Key.startsWith("$") || Key.startsWith("_") || Key === "__v") continue;
    Cleaned[Key] = ToJSON(Obj[Key]);
  }
  return Cleaned;
}

function FormatMatchDeadline(MatchData: any): any {
  if (!MatchData) return null;
  const Clean = ToJSON(MatchData);
  if (Clean.deadline instanceof Date) {
    Clean.deadline = Clean.deadline.toISOString();
  }
  return Clean;
}

async function GetUserData(UserId: string, TournamentId: string): Promise<any> {
  const User = await BackboneUser.findOne({ UserId }).lean();
  if (!User) return null;
  const Data = (User.Tournaments as any).get
    ? (User.Tournaments as any).get(TournamentId)
    : User.Tournaments[TournamentId];
  if (!Data) return null;
  return { ...Data, UserPosition: Data.UserPosition || [] };
}

/**
 * بناء prize-setting بشكل صحيح.
 * إذا في جوائز حقيقية تُرسل كلها، وإلا يُرسل جائزة افتراضية رمزية.
 */
function BuildPrizeSetting(Tour: any): Array<{
  reward: Array<{
    "@position": string;
    item: Array<{ "@amount": string; "@type": string; "@id": string; "@external-id": string }>;
  }>;
}> {
  const prizes = Array.isArray(Tour.Prizes) ? Tour.Prizes : [];
  const poolId = Tour.PrizepoolId?.toString() || "1019395748292202883";

  if (prizes.length > 0) {
    return [
      {
        reward: prizes.map((prize: any) => ({
          "@position": String(prize.position),
          item: [
            {
              "@amount": String(prize.amount),
              "@type": "10",
              "@id": poolId,
              "@external-id": "4",
            },
          ],
        })),
      },
    ];
  }

  // لا توجد جوائز — جائزة افتراضية رمزية (المبلغ 0)
  return [
    {
      reward: [
        {
          "@position": "1",
          item: [{ "@amount": "0", "@type": "10", "@id": poolId, "@external-id": "4" }],
        },
      ],
    },
  ];
}

// ─── MAIN FUNCTION ────────────────────────────────────────────────────────────

export async function TournamentGetData(
  TournamentId: string,
  GetAll: number,
  Ready: number,
  Token: string
): Promise<TournamentResponse | { message: string }> {
  const [Tour, LPAccount] = await Promise.all([
    Tournament.findOne({ TournamentId }),
    LPUser.findOne({ AccessToken: Token }).lean(),
  ]);

  if (!Tour || !LPAccount) return { message: "" };

  const User = await BackboneUser.findOne({ UserId: LPAccount.UserId });
  if (!User) return { message: "" };

  // ─── تحديث عدد المسجلين الفعلي ──────────────────────────────────────────
  const SignedCount = await BackboneUser.countDocuments({
    [`Tournaments.${TournamentId}`]: { $exists: true },
    [`Tournaments.${TournamentId}.SignedUp`]: true,
  });
  if (Tour.CurrentInvites !== SignedCount) Tour.CurrentInvites = SignedCount;

  const Opens  = new Date(Tour.SignupStart);
  const Starts = new Date(Tour.StartTime);
  const Closes = new Date(Starts.getTime() - 75 * 1000);
  const Now    = new Date();

  // ─── حساب الحالة ─────────────────────────────────────────────────────────
  let Status = TournamentStatus.NotStarted;
  if (Tour.Status !== TournamentStatus.Canceled && Tour.Status !== TournamentStatus.Finished) {
    if (Now < Opens) {
      Status = TournamentStatus.NotStarted;
    } else if (Now <= Closes) {
      Status = TournamentStatus.InvitationOpen;
    } else if (Now < Starts) {
      Status = TournamentStatus.InvitationClose;
      await GenerateBracketMatches(Tour);
    } else {
      if (!Tour.CurrentPhaseStarted) {
        Tour.CurrentPhaseId = 1;
        Tour.CurrentPhaseStarted = new Date();
        Tour.NextPhaseStarted = new Date(Date.now() + (await GetNextPhaseStarted(Tour)));
        await Tour.save();
      }
      Status = TournamentStatus.Running;

      const Phase = Tour.CurrentPhaseId || 1;
      if (Phase === Tour.Phases.length) {
        const AllMatches = await Match.find({
          tournamentid: TournamentId.toString(),
          phaseid: Phase,
          groupid: 0,
        }).lean();

        let LastRound = 0;
        for (const m of AllMatches) if (m.roundid > LastRound) LastRound = m.roundid;

        const LastRoundMatches = AllMatches.filter((m) => m.roundid === LastRound);
        const AllClosed =
          LastRoundMatches.length > 0 &&
          LastRoundMatches.every(
            (m) => m.status === TournamentMatchStatus.Closed || m.status === TournamentMatchStatus.GameFinished
          );

        if (AllClosed) {
          Tour.Status = TournamentStatus.Finished;
          Status = TournamentStatus.Finished;
          await Tour.save();
        }
      }
    }
  } else {
    Status = Tour.Status;
  }

  // ─── بناء الـ Response الأساسي ────────────────────────────────────────────
  const Response: TournamentResponse = {
    party: [{}] as any,
    userPosition: [],
    userMatch: null,
    userMatches: [],
    tournamentData: [
      {
        id: Tour.TournamentId,
        type: Tour.TournamentType,
        status: Status,
        tournamenttime: Tour.StartTime.toISOString(),
        cashStatus: 0,
        cashTournament: false,
        season: 1,
        seasonpart: 1,
        invitationopens: Tour.SignupStart.toISOString(),
        invitationcloses: Closes.toISOString(),
        maxinvites: Tour.MaxInvites,
        partysize: Tour.PartySize,
        currentinvites: Tour.CurrentInvites,
        phasecount: Tour.Phases.length,
        roundcount: Tour.RoundCount,
        sponsorimage: "",
        sponsorname: "",
        currentphaseid: Tour.CurrentPhaseId || 0,
        currentphasestarted: Tour.CurrentPhaseStarted?.toISOString() || null,
        nextphase: Tour.NextPhaseStarted?.toISOString() || null,
        name: Tour.TournamentName,
        image: null,
        icon: Tour.TournamentImage,
        "theme-color": Tour.TournamentColor,
        data: {
          "tournament-data": {
            "invitation-setting": [
              {
                requirements: [
                  { "custom-requirement": [{ "@name": "server_region", "@value": Tour.Region.toLowerCase() }] },
                ],
              },
            ],
            "rules-setting": [GetRulesSettings(Tour)],
            // ✅ FIX: prize-setting يُبنى بشكل صحيح دائماً
            "prize-setting": BuildPrizeSetting(Tour),
            "property-setting": GetProperties(Tour),
            "description-data": [
              {
                language: [
                  {
                    "@code": "en",
                    name: [{ "#text": [{ value: Tour.TournamentName }] }],
                    policy: [{ "@url": "" }],
                    general: [{ "@main-icon": Tour.TournamentImage, "@theme-color": Tour.TournamentColor }],
                  },
                ],
              },
            ],
            "sponsor-data": [{ "@name": "", "@image": "" }],
            "stream-data": [{ "@stream-link": Tour.Properties?.StreamURL ?? "" }],
            "highlights-data": [{ "@highlights-link": Tour.Properties?.HighlightsURL ?? "" }],
            "winner-data":
              (Tour.Winners?.length ?? 0) > 0
                ? [{ user: (Tour.Winners ?? []).map((W: any) => ({ "@user-id": W.userId, "@nick": W.nick })) }]
                : undefined,
          },
        },
        privateCode: null,
        inviteId: null,
        inviteAceptedAt: null,
        inviteDeclinedAt: null,
        inviteStatus: TournamentUserStatus.Confirmed,
        invitePartyId: null,
        inviteIsPartyLeader: false,
        invitePartyCode: null,
        checkIn: true,
        prizeDelivered: null,
        userPlace: 0,
        isAdministrator: false,
      },
    ],
  };

  const IsAdmin     = Tour.Properties?.AdminIds?.includes(User.UserId) ?? false;
  const IsInviteOnly = Tour.Properties?.IsInvitationOnly ?? false;
  const IsInvited   = IsInviteOnly && (Tour.Properties?.InvitedIds?.includes(User.UserId) ?? false);

  if (IsAdmin) Response.tournamentData[0].isAdministrator = true;
  if ((IsInviteOnly && IsInvited) || !IsInviteOnly) Response.tournamentData[0].openregistration = 0;

  // ─── رسوم الدخول ─────────────────────────────────────────────────────────
  if (Tour.EntryFee && Tour.EntryFee > 0) {
    Response.tournamentData[0].data["tournament-data"]["invitation-setting"].push({
      "entry-fee": [
        {
          item: [
            {
              "@amount": Tour.EntryFee.toString(),
              "@type": "10",
              "@id": Tour.PrizepoolId?.toString() || "null",
              "@external-id": "4",
            },
          ],
        },
      ],
    });
  }

  const Info = User.Tournaments?.get(TournamentId.toString());
  if (!Info?.SignedUp) return Response;

  // ─── إذا كانت البطولة invite-only والمستخدم غير مدعو ────────────────────
  if (IsInviteOnly && !IsInvited) {
    Info.SignedUp = false;
    await Promise.all([
      User.save(),
      Tournament.updateOne({ TournamentId: Tour.TournamentId }, { $inc: { CurrentInvites: -1 } }),
    ]);
    return Response;
  }

  // ─── بيانات المستخدم المسجل ───────────────────────────────────────────────
  Response.tournamentData[0].inviteId       = Info.InviteId?.toString() || null;
  Response.tournamentData[0].invitePartyId  = Info.InviteId?.toString() || null;
  if (Tour.PartySize > 1) Response.tournamentData[0].invitePartyCode = Info.PartyCode || null;
  Response.tournamentData[0].inviteStatus   = TournamentUserStatus.Confirmed;
  Response.tournamentData[0].inviteAceptedAt = Info.AcceptedAt.toISOString();
  Response.tournamentData[0].checkIn        = true;

  if (Info.PartyMembers) {
    Response.party = Info.PartyMembers.map((PartyUser: any) => ({
      userId: PartyUser.UserId.toString(),
      status: PartyUser.Status,
      checkIn: true,
      isPartyLeader: PartyUser.IsPartyLeader,
      nick: PartyUser.Username,
    }));

    // تحديث الأسماء إذا تغيرت
    if (User.Username !== Response.party.find((p) => p.userId === User.UserId)?.nick) {
      const TeammatesUserIds = Info.PartyMembers.map((pm: any) => pm.UserId);
      const DatabaseTeammates = await BackboneUser.find({ UserId: { $in: TeammatesUserIds } }).lean();
      Info.PartyMembers = Info.PartyMembers.map((pm: any) => {
        const fresh = DatabaseTeammates.find((u) => u.UserId === pm.UserId);
        return fresh ? { ...pm, Username: fresh.Username } : pm;
      });
      Response.party = Info.PartyMembers.map((PartyUser: any) => ({
        userId: PartyUser.UserId.toString(),
        status: PartyUser.Status,
        checkIn: true,
        isPartyLeader: PartyUser.IsPartyLeader,
        nick: PartyUser.Username,
      }));
      await User.save();
    }

    const CurrentUser = Info.PartyMembers.find((PartyUser: any) => PartyUser.UserId === User.UserId);
    if (CurrentUser) {
      Response.tournamentData[0].inviteIsPartyLeader = CurrentUser.IsPartyLeader;
      if (Info.PartyMembers.some((m: any) => m.IsKicked))
        Response.tournamentData[0].inviteStatus = TournamentUserStatus.KickedOutByAdmin;
    }
  }

  if (Now < Starts) {
    await Promise.all([Tour.save(), User.save()]);
    return Response;
  }

  if (
    User.Tournaments?.get(Tour.TournamentId.toString())?.PartyMembers?.length !== Tour.PartySize &&
    Info.PartyMembers
  ) {
    Info.PartyMembers.forEach((PartyUser: any) => (PartyUser.Status = TournamentUserStatus.PartyNotFull));
    Response.tournamentData[0].inviteStatus = TournamentUserStatus.PartyNotFull;
  }

  const Phase    = Tour.CurrentPhaseId || 1;
  const UserData = await GetUserData(User.UserId, TournamentId.toString());
  Response.userPosition = UserData ? UserData.UserPosition : [];

  if (GetAll === 0) {
    Response.party = [];
    Response.tournamentData = [];
  }

  const DatabaseMatch = await GetUserMatch(User, Tour);
  Response.userMatch = FormatMatchDeadline(DatabaseMatch);

  // تنظيف UserMatch المنتهي
  if (Info.UserMatch && Info.UserMatch.id) {
    const ValidateMatch = await Match.findOne({
      id: Info.UserMatch.id,
      status: { $in: [TournamentMatchStatus.Closed, TournamentMatchStatus.GameFinished] },
    }).lean();
    if (ValidateMatch) {
      Info.UserMatch = null;
      await BackboneUser.updateOne(
        { UserId: User.UserId },
        { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: null } }
      );
      Response.userMatch = null;
    }
  }

  if (Info.UserMatches?.length > 0) {
    Response.userMatches = Info.UserMatches.map((m: any) => FormatMatchDeadline(m));
  }

  if (Ready === 0 && Response.userMatch) {
    const UpdatedMatch = await Match.findOne({ id: Response.userMatch.id }).lean();
    if (UpdatedMatch) {
      Response.userMatch = FormatMatchDeadline(UpdatedMatch);
      await BackboneUser.findOneAndUpdate(
        { UserId: User.UserId },
        { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: Response.userMatch } }
      );
    }
  }

  if (Ready === 1 && GetAll === 1) {
    const PhaseConfig = Tour.Phases[Phase - 1];
    const TypeNum  = Number(PhaseConfig.PhaseType) || TournamentPhaseType.SingleEliminationBracket;
    const PhaseType = TournamentPhaseType[TypeNum] as keyof typeof TournamentPhaseType;

    if (PhaseType !== "RoundRobin" && PhaseType !== "Arena") {
      const Pos = Info.UserPosition?.find((P: any) => P.phaseid === Phase);
      if (Pos && Pos.matchloses > 0) Info.KnockedOut = true;
    }

    if (!Response.userMatch && !Info.KnockedOut) {
      await AssignNextMatchIfNeeded(User, Tour);
      const NewMatch = await GetUserMatch(User, Tour);
      if (NewMatch) Response.userMatch = FormatMatchDeadline(NewMatch);
    }
  }

  if (Ready === 1 && GetAll === 0 && Response.userMatch) {
    const PhaseConfig = Tour.Phases[Phase - 1];
    const TypeNum  = Number(PhaseConfig.PhaseType) || TournamentPhaseType.SingleEliminationBracket;
    const PhaseType = TournamentPhaseType[TypeNum] as keyof typeof TournamentPhaseType;

    if (PhaseType !== "RoundRobin" && PhaseType !== "Arena") {
      const Pos = Info.UserPosition?.find((P: any) => P.phaseid === Phase);
      if (Pos && Pos.matchloses > 0) Info.KnockedOut = true;
    }

    if (Info.KnockedOut) {
      Response.userMatch = null;
      if (Info.UserMatches?.length > 0)
        Response.userMatches = Info.UserMatches.map((m: any) => FormatMatchDeadline(m));
      const UD = await GetUserData(User.UserId, TournamentId.toString());
      Response.userPosition = UD ? UD.UserPosition : [];
      await Promise.all([Tour.save(), User.save()]);
      return ToJSON(Response);
    }

    const CurrentMatch = await Match.findOne({ id: Response.userMatch.id }).lean();
    if (!CurrentMatch) {
      Response.userMatch = null;
      await BackboneUser.findOneAndUpdate(
        { UserId: User.UserId },
        { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: null } }
      );
      await Promise.all([Tour.save(), User.save()]);
      return ToJSON(Response);
    }

    if (
      CurrentMatch.status === TournamentMatchStatus.Closed ||
      CurrentMatch.status === TournamentMatchStatus.GameFinished
    ) {
      Response.userMatch = null;
      await BackboneUser.findOneAndUpdate(
        { UserId: User.UserId },
        { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: null } }
      );
      await Promise.all([Tour.save(), User.save()]);
      return ToJSON(Response);
    }

    if (CurrentMatch.status === TournamentMatchStatus.GameInProgress) {
      Response.userMatch = FormatMatchDeadline(CurrentMatch);
      await BackboneUser.findOneAndUpdate(
        { UserId: User.UserId },
        { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: FormatMatchDeadline(CurrentMatch) } }
      );
      await Promise.all([Tour.save(), User.save()]);
      return ToJSON(Response);
    }

    const UserInMatch = CurrentMatch.users.find((u: any) => u["@user-id"] === User.UserId);
    if (!UserInMatch) {
      Response.userMatch = null;
      await BackboneUser.findOneAndUpdate(
        { UserId: User.UserId },
        { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: null } }
      );
      await Promise.all([Tour.save(), User.save()]);
      return ToJSON(Response);
    }

    const WinnerInMatch = CurrentMatch.users.find((u: any) => u["@match-winner"] === "1");
    if (WinnerInMatch) {
      const WinnerId = WinnerInMatch["@user-id"];
      const MatchSnapshot = {
        id: CurrentMatch.id, secret: CurrentMatch.secret, deadline: CurrentMatch.deadline,
        matchid: CurrentMatch.matchid, phaseid: CurrentMatch.phaseid, groupid: CurrentMatch.groupid,
        roundid: CurrentMatch.roundid, playedgamecount: CurrentMatch.playedgamecount,
        status: CurrentMatch.status, tournamentid: CurrentMatch.tournamentid, users: CurrentMatch.users,
      };
      await BackboneUser.updateOne(
        { UserId: WinnerId, [`Tournaments.${Tour.TournamentId}`]: { $exists: true } },
        { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: MatchSnapshot } }
      );
      const Winner = await BackboneUser.findOne({ UserId: WinnerId });
      if (Winner) {
        await Qualify(Winner, Tour);
        if (WinnerId === User.UserId) {
          const UpdatedUser = await BackboneUser.findOne({ UserId: User.UserId });
          const UpdatedInfo = UpdatedUser?.Tournaments.get(Tour.TournamentId.toString());
          if (UpdatedInfo) {
            const NewMatch = await GetUserMatch(UpdatedUser!, Tour);
            Response.userMatch = FormatMatchDeadline(NewMatch);
            if (NewMatch) {
              await BackboneUser.findOneAndUpdate(
                { UserId: UpdatedUser!.UserId },
                { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: FormatMatchDeadline(NewMatch) } }
              );
            }
            if (UpdatedInfo.UserMatches?.length > 0)
              Response.userMatches = UpdatedInfo.UserMatches.map((m: any) => FormatMatchDeadline(m));
          }
        }
      }
      await Promise.all([Tour.save(), User.save()]);
      return ToJSON(Response);
    }

    if (UserInMatch["@checked-in"] === "1") {
      const Configs    = GetRoundConfigs(Tour);
      const Deadline   = GetMatchDeadline(CurrentMatch, Tour, Configs);
      const GracePeriod = new Date(Deadline.getTime() + 5000);

      if (Now >= GracePeriod) {
        const CheckedInUsers = CurrentMatch.users.filter((u: any) => u["@checked-in"] === "1");
        const PartyIds = Info.PartyMembers?.map((p: any) => p.UserId.toString()) || [User.UserId];
        const AllPartyCheckedIn = PartyIds.every((id: string) =>
          CheckedInUsers.some((u: any) => u["@user-id"] === id)
        );
        const OtherTeamsCheckedIn = CurrentMatch.users.some(
          (u: any) => !PartyIds.includes(u["@user-id"]) && u["@checked-in"] === "1"
        );

        if (AllPartyCheckedIn && !OtherTeamsCheckedIn) {
          const UpdatedUsers = CurrentMatch.users.map((u: any) => {
            if (PartyIds.includes(u["@user-id"]))
              return { ...u, "@match-winner": "1", "@match-points": "1", "@team-score": "1" };
            return { ...u, "@match-winner": "0", "@match-points": "0", "@team-score": "0" };
          });
          await Match.updateOne(
            { id: Response.userMatch!.id, status: { $nin: [TournamentMatchStatus.Closed, TournamentMatchStatus.GameFinished] } },
            { $set: { users: UpdatedUsers, status: TournamentMatchStatus.Closed } }
          );
          const AutoWinSnapshot = {
            id: CurrentMatch.id, secret: CurrentMatch.secret, deadline: CurrentMatch.deadline,
            matchid: CurrentMatch.matchid, phaseid: CurrentMatch.phaseid, groupid: CurrentMatch.groupid,
            roundid: CurrentMatch.roundid, playedgamecount: CurrentMatch.playedgamecount,
            status: TournamentMatchStatus.Closed, tournamentid: CurrentMatch.tournamentid, users: UpdatedUsers,
          };
          await BackboneUser.updateOne(
            { UserId: User.UserId, [`Tournaments.${Tour.TournamentId}`]: { $exists: true } },
            { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: AutoWinSnapshot } }
          );
          const FreshUser = await BackboneUser.findOne({ UserId: User.UserId });
          if (FreshUser) await Qualify(FreshUser, Tour);
          const UpdatedUser = await BackboneUser.findOne({ UserId: User.UserId });
          const UpdatedInfo = UpdatedUser?.Tournaments.get(Tour.TournamentId.toString());
          if (UpdatedInfo) {
            const NewMatch = await GetUserMatch(UpdatedUser!, Tour);
            Response.userMatch = FormatMatchDeadline(NewMatch);
            if (NewMatch) {
              await BackboneUser.findOneAndUpdate(
                { UserId: UpdatedUser!.UserId },
                { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: FormatMatchDeadline(NewMatch) } }
              );
            }
            if (UpdatedInfo.UserMatches?.length > 0)
              Response.userMatches = UpdatedInfo.UserMatches.map((m: any) => FormatMatchDeadline(m));
          }
          await Promise.all([Tour.save(), User.save()]);
          return ToJSON(Response);
        }
      }

      const RefreshedMatch = await Match.findOne({ id: Response.userMatch.id }).lean();
      Response.userMatch = FormatMatchDeadline(RefreshedMatch);
      await Promise.all([Tour.save(), User.save()]);
      return ToJSON(Response);
    }

    // ─── Check-in المستخدم ────────────────────────────────────────────────
    await Match.updateOne(
      { id: Response.userMatch.id, status: { $nin: [TournamentMatchStatus.Closed, TournamentMatchStatus.GameFinished] } },
      { $set: { "users.$[elem].@checked-in": "1" } },
      { arrayFilters: [{ "elem.@user-id": User.UserId.toString() }] }
    );

    const FreshMatch = await Match.findOne({ id: Response.userMatch.id }).lean();
    if (FreshMatch) {
      Response.userMatch = FormatMatchDeadline(FreshMatch);
      await BackboneUser.findOneAndUpdate(
        { UserId: User.UserId },
        { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: FormatMatchDeadline(FreshMatch) } }
      );

      if (FreshMatch.status === TournamentMatchStatus.WaitingForOpponent) {
        const UniqueTeams = new Set(FreshMatch.users.map((U: any) => U["@team-id"]).filter((T: string) => T));
        if (UniqueTeams.size === Tour.MaxPlayersPerMatch) {
          const Configs = GetRoundConfigs(Tour);
          const Config  = Configs.get(FreshMatch.roundid);
          let NewDeadline: Date;
          if (Config) {
            const TotalMinutes   = Config.MaxGameCount * Config.MinGameLength;
            const AdjustedMinutes = TotalMinutes === Config.MaxLength ? TotalMinutes - 1 : TotalMinutes;
            NewDeadline = new Date(Date.now() + 1.5 * 60 * 1000 + AdjustedMinutes * 60 * 1000 + 15000);
          } else {
            NewDeadline = new Date(Date.now() + 1.5 * 60 * 1000);
          }
          await Match.updateOne(
            { id: FreshMatch.id, status: TournamentMatchStatus.WaitingForOpponent },
            { $set: { status: TournamentMatchStatus.GameReady, deadline: NewDeadline } }
          );
          const UpdatedFreshMatch = await Match.findOne({ id: FreshMatch.id }).lean();
          if (UpdatedFreshMatch) {
            Response.userMatch = FormatMatchDeadline(UpdatedFreshMatch);
            await BackboneUser.findOneAndUpdate(
              { UserId: User.UserId },
              { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: FormatMatchDeadline(UpdatedFreshMatch) } }
            );
          }
        }
      }
    }
  } else if (Info.UserMatch && !Info.UserMatch.id) {
    const DBMatch = await GetUserMatch(User, Tour);
    if (DBMatch) {
      await BackboneUser.findOneAndUpdate(
        { UserId: User.UserId },
        { $set: { [`Tournaments.${Tour.TournamentId}.UserMatch`]: FormatMatchDeadline(DBMatch) } }
      );
    }
  }

  // ─── المستخدم خسر أو طُرد ────────────────────────────────────────────────
  if (Info.KnockedOut || Info.PartyMembers?.some((m: any) => m.UserId === User.UserId && m.IsKicked)) {
    Response.userMatch = null;
    if (Info.UserMatches?.length > 0)
      Response.userMatches = Info.UserMatches.map((m: any) => FormatMatchDeadline(m));
    const UD = await GetUserData(User.UserId, TournamentId.toString());
    Response.userPosition = UD ? UD.UserPosition : [];

    // إضافة المركز النهائي إذا انتهت البطولة
    if (Info.FinalPlace > 0) {
      Response.tournamentData[0].userPlace = Info.FinalPlace;
      Response.tournamentData[0].prizeDelivered = true;
    }

    await Promise.all([Tour.save(), User.save()]);
    return ToJSON(Response);
  }

  await Promise.all([Tour.save(), User.save()]);
  return ToJSON(Response);
}
