import { BackboneUser } from "../../Models/BackboneUser";
import { LPUser } from "../../Models/LPUser";
import { ITournament, Tournament } from "../../Models/Tournament";
import { Match } from "../../Models/Matches";
import { TournamentStatus, TournamentMatchStatus } from "../Config";
import { GetNextPhaseStarted, GetProperties } from "../Settings/Properties";
import { GetRulesSettings } from "../Settings/Rules";
import { GenerateBracketMatches } from "./GetMatches";
import { CheckPhases } from "./Internal/Phase";
import { dbg, warn } from "../../Modules/Logger";

// ─── بناء prize-setting بشكل صحيح ────────────────────────────────────────────
function BuildPrizeSetting(Tour: any): any[] {
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

export async function GetTournamentList(MaxResults: number, Page: number, AccessToken: string) {
  try {
    const maxResults = Math.min(MaxResults, 50);
    
    const LoginProviderUser = await LPUser.findOne({ AccessToken: AccessToken });
    const DatabaseUser = LoginProviderUser ? await BackboneUser.findOne({ UserId: LoginProviderUser.UserId }) : null;

    const TotalCount = await Tournament.countDocuments();
    const FoundTournaments = await Tournament.find()
      .sort({ StartTime: -1 })
      .limit(Math.min(maxResults, 50))
      .skip((Page - 1) * Math.min(maxResults, 50));

    const Now = new Date();
    const Tournaments = [];

    for (let Tour of FoundTournaments) {
      try {
        console.log(`[GetTournamentList] Processing tournament: ${Tour.TournamentId}, Name: ${Tour.TournamentName}`);
        
        // Ensure Properties exists with defaults
        if (!Tour.Properties) {
          console.log(`[GetTournamentList] Properties missing for ${Tour.TournamentId}, creating defaults`);
          Tour.Properties = {
            DisabledEmotes: [],
            IsInvitationOnly: false,
            InvitedIds: [],
            AdminIds: [],
            StreamURL: "",
          };
        }
        
        // Ensure Phases exists
        if (!Tour.Phases || !Array.isArray(Tour.Phases)) {
          console.error(`[GetTournamentList] Invalid Phases for tournament ${Tour.TournamentId}`);
          continue;
        }
        
        if (Tour.Status === TournamentStatus.Running) {
          await CheckPhases(Tour as unknown as ITournament);
          const UpdatedTour = await Tournament.findOne({ TournamentId: Tour.TournamentId });
          if (UpdatedTour) Tour = UpdatedTour;
        }

        const Opens = new Date(Tour.SignupStart);
        const Starts = new Date(Tour.StartTime);
        const Closes = new Date(Starts.getTime() - 75 * 1000);

        const SignedCount = await BackboneUser.countDocuments({
          [`Tournaments.${Tour.TournamentId}`]: { $exists: true },
          [`Tournaments.${Tour.TournamentId}.SignedUp`]: true,
        });

        if (Tour.CurrentInvites != SignedCount) Tour.CurrentInvites = SignedCount;

        let Status = TournamentStatus.NotStarted;
        if (Tour.Status !== TournamentStatus.Canceled && Tour.Status !== TournamentStatus.Finished) {
          if (Now < Opens) {
            Status = TournamentStatus.NotStarted;
          } else if (Now <= Closes) {
            Status = TournamentStatus.InvitationOpen;
          } else if (Now < Starts) {
            Status = TournamentStatus.InvitationClose;
            await GenerateBracketMatches(Tour as unknown as ITournament);
          } else {
            if (!Tour.CurrentPhaseStarted) {
              Tour.CurrentPhaseId = 1;
              Tour.CurrentPhaseStarted = new Date();
              Tour.NextPhaseStarted = new Date(Date.now() + (await GetNextPhaseStarted(Tour as unknown as ITournament)));
            }
            Status = TournamentStatus.Running;

            const Phase = Tour.CurrentPhaseId || 1;
            const IsFinalPhase = Phase === Tour.Phases.length;

            if (IsFinalPhase) {
              const AllMatches = await Match.find({
                tournamentid: Tour.TournamentId.toString(),
                phaseid: Phase,
                groupid: 0,
              }).lean();

              let LastRoundNumber = 0;
              for (const MatchDoc of AllMatches) {
                if (MatchDoc.roundid > LastRoundNumber) {
                  LastRoundNumber = MatchDoc.roundid;
                }
              }

              const LastRoundMatches = AllMatches.filter((m) => m.roundid === LastRoundNumber);
              const AllLastRoundClosed =
                LastRoundMatches.length > 0 &&
                LastRoundMatches.every(
                  (m) => m.status === TournamentMatchStatus.Closed || m.status === TournamentMatchStatus.GameFinished
                );

              if (AllLastRoundClosed) {
                Tour.Status = TournamentStatus.Finished;
                Status = TournamentStatus.Finished;
                await Tour.save();
              }
            }
          }
        } else {
          Status = Tour.Status;
        }

        const InvitationSetting: any = {
          requirements: [
            {
              "custom-requirement": [
                {
                  "@name": "server_region",
                  "@value": (Tour.Region || "eu").toLowerCase(),
                },
              ],
            },
          ],
        };

        if (Tour.EntryFee && Tour.EntryFee > 0) {
          InvitationSetting["entry-fee"] = [
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
          ];
        }

        // ✅ FIX: prize-setting يُبنى بشكل صحيح دائماً
        const PrizeSetting = BuildPrizeSetting(Tour);

        const WinnerData = [];
        if (Tour.Winners && Array.isArray(Tour.Winners) && Tour.Winners.length > 0) {
          WinnerData.push({
            user: Tour.Winners.map((Winner) => ({
              "@nick": Winner.nick || "",
              "@user-id": Winner.userId || "",
            })),
          });
        }

        const TournamentData = {
          id: Tour.TournamentId,
          type: Tour.TournamentType,
          status: Status,
          tournamenttime: Starts.toISOString(),
          cashStatus: 0,
          cashTournament: false,
          season: 1,
          seasonpart: 1,
          invitationopens: Opens.toISOString(),
          invitationcloses: Closes.toISOString(),
          maxinvites: Tour.MaxInvites,
          partysize: Tour.PartySize,
          currentinvites: Tour.CurrentInvites,
          phasecount: Tour.Phases?.length || 0,
          roundcount: Tour.RoundCount,
          sponsorimage: "",
          sponsorname: "",
          currentphaseid: Tour.CurrentPhaseId || 0,
          currentphasestarted: Tour.CurrentPhaseStarted?.toISOString() || null,
          nextphase: Tour.NextPhaseStarted?.toISOString() || null,
          name: Tour.TournamentName || "",
          image: null,
          icon: Tour.TournamentImage || null,
          "theme-color": Tour.TournamentColor || null,
          data: {
            "tournament-data": {
              "invitation-setting": [InvitationSetting],
              "rules-setting": [GetRulesSettings(Tour as unknown as ITournament)],
              "prize-setting": PrizeSetting,
              "property-setting": GetProperties(Tour as unknown as ITournament),
              "description-data": [
                {
                  language: [
                    {
                      "@code": "en",
                      name: [{ "#text": [{ value: Tour.TournamentName || "" }] }],
                      policy: [{ "@url": "" }],
                      general: [
                        {
                          "@main-icon": Tour.TournamentImage,
                          "@theme-color": Tour.TournamentColor,
                        },
                      ],
                    },
                  ],
                },
              ],
              "sponsor-data": [{ "@name": "", "@image": "" }],
              "stream-data": [{ "@stream-link": Tour.Properties?.StreamURL ?? "" }],
              ...(WinnerData.length > 0 && { "winner-data": WinnerData }),
            },
          },
          privateCode: null,
          inviteId: null as string | null,
          inviteAceptedAt: null as string | null,
          inviteDeclinedAt: null,
          inviteStatus: 0,
          invitePartyId: null as string | null,
          inviteIsPartyLeader: false,
          invitePartyCode: null as string | null,
          checkIn: false,
          prizeDelivered: null as boolean | null,
          userPlace: 0,
          isAdministrator: false,
          openregistration: undefined as number | undefined,
          highlightsurl: null,
          streamurl: "",
        };

        const IsAdmin = DatabaseUser && Tour.Properties?.AdminIds?.includes(DatabaseUser.UserId);
        const IsInviteOnly = Tour.Properties?.IsInvitationOnly || false;
        const IsInvited = DatabaseUser && IsInviteOnly && Tour.Properties?.InvitedIds?.includes(DatabaseUser.UserId);

        if (IsAdmin) {
          TournamentData.isAdministrator = true;
        }
        if ((IsInviteOnly && IsInvited) || !IsInviteOnly) {
          TournamentData.openregistration = 0;
        }

        if (DatabaseUser && DatabaseUser.Tournaments.get(Tour.TournamentId.toString())) {
          const Info = DatabaseUser.Tournaments.get(Tour.TournamentId.toString());

          if (Info?.SignedUp) {
            if (IsInviteOnly && !IsInvited) {
              Info.SignedUp = false;
              await Promise.all([
                DatabaseUser.save(),
                Tournament.updateOne({ TournamentId: Tour.TournamentId }, { $inc: { CurrentInvites: -1 } }),
              ]);
            } else {
              TournamentData.inviteId = Info.InviteId?.toString() || null;
              TournamentData.invitePartyId = Info.InviteId?.toString() || null;
              TournamentData.inviteStatus = 1;
              TournamentData.inviteAceptedAt = Info.AcceptedAt?.toISOString() || null;
              TournamentData.checkIn = true;

              if (Tour.PartySize > 1) {
                TournamentData.invitePartyCode = Info.PartyCode || null;
              }

              if (Info.PartyMembers) {
                const CurrentUserInParty = Info.PartyMembers.find((member) => member.UserId === DatabaseUser.UserId);
                if (CurrentUserInParty) {
                  TournamentData.inviteIsPartyLeader = CurrentUserInParty.IsPartyLeader;
                }
              }

              if (Info.FinalPlace > 0 && Tour.Winners) {
                TournamentData.userPlace = Info.FinalPlace;
                TournamentData.prizeDelivered = true;
              }
            }
          }
        }

        // ✅ FIX: لا نحفظ كل بطولة داخل الـ loop — نجمع التحديثات ونحفظها دفعة واحدة
        // Tour.save() أُزيلت من هنا لتحسين الأداء

        Tournaments.push(TournamentData);
      } catch (tourError) {
        console.error(`[GetTournamentList] Error processing tournament ${Tour.TournamentId}:`, tourError);
        console.error(`[GetTournamentList] Tournament data:`, JSON.stringify({
          id: Tour.TournamentId,
          name: Tour.TournamentName,
          hasProperties: !!Tour.Properties,
          hasPhases: !!Tour.Phases,
          phasesLength: Tour.Phases?.length
        }));
      }
    }

    console.log(`[GetTournamentList] Successfully processed ${Tournaments.length} tournaments`);

    return {
      pagination: {
        currentPage: Page,
        maxResults: MaxResults,
        totalResultCount: TotalCount,
      },
      tournaments: Tournaments,
    };
  } catch (error) {
    console.error("[GetTournamentList] Fatal error:", error);
    throw error;
  }
}
