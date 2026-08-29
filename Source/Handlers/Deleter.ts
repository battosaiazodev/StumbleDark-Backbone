import { Tournament } from "../Models/Tournament";
import { Match } from "../Models/Matches";
import { BackboneUser } from "../Models/BackboneUser";
import { TournamentStatus } from "../Backbone/Config";
import { warn, msg } from "../Modules/Logger";

// ─── إعدادات التنظيف ──────────────────────────────────────────────────────────
const CLEANUP_INTERVAL_MS  = 45 * 60 * 1000; // كل 45 دقيقة
const FINISHED_GRACE_MS    = 45 * 60 * 1000; // 45 دقيقة بعد انتهاء آخر مباراة
const CANCELED_GRACE_MS    = 10 * 60 * 1000; // 10 دقائق بعد الإلغاء

export class TournamentCleaner {
  private static IsRunning = false;

  private static async Clean(): Promise<void> {
    const Now = new Date();

    // ─── تنظيف البطولات المنتهية ──────────────────────────────────────────
    const FinishedTours = await Tournament.find({ Status: TournamentStatus.Finished }).lean();

    for (const Tour of FinishedTours) {
      try {
        const TournamentId = Tour.TournamentId.toString();
        const LastPhaseId  = Tour.Phases.length;

        const LastMatch = await Match.findOne({
          tournamentid: TournamentId,
          phaseid: LastPhaseId,
        })
          .sort({ roundid: -1 })
          .select("deadline status")
          .lean();

        // إذا ما في مباريات أو انتهت المهلة
        const ShouldClean =
          !LastMatch ||
          (new Date(LastMatch.deadline) < new Date(Now.getTime() - FINISHED_GRACE_MS) &&
            LastMatch.status === 8);

        if (ShouldClean) {
          await this.DeleteTournamentData(TournamentId);
          msg(`[Cleaner] Cleaned finished tournament: ${TournamentId}`);
        }
      } catch (err) {
        warn(`[Cleaner] Error cleaning finished tournament ${Tour.TournamentId}: ${err}`);
      }
    }

    // ─── تنظيف البطولات الملغاة ───────────────────────────────────────────
    const CanceledGrace = new Date(Now.getTime() - CANCELED_GRACE_MS);
    const CanceledTours = await Tournament.find({
      Status: TournamentStatus.Canceled,
      // نتحقق من وقت آخر تحديث إذا كان متاحاً
    }).lean();

    for (const Tour of CanceledTours) {
      try {
        const TournamentId = Tour.TournamentId.toString();
        // نحذف البطولات الملغاة التي ليس فيها لاعبون
        const PlayerCount = await BackboneUser.countDocuments({
          [`Tournaments.${TournamentId}`]: { $exists: true },
          [`Tournaments.${TournamentId}.SignedUp`]: true,
        });

        if (PlayerCount === 0) {
          await this.DeleteTournamentData(TournamentId);
          msg(`[Cleaner] Cleaned canceled tournament: ${TournamentId}`);
        }
      } catch (err) {
        warn(`[Cleaner] Error cleaning canceled tournament ${Tour.TournamentId}: ${err}`);
      }
    }
  }

  /**
   * حذف كل بيانات بطولة معينة (المباريات + بيانات اللاعبين + البطولة نفسها)
   */
  public static async DeleteTournamentData(TournamentId: string): Promise<void> {
    await Promise.all([
      Match.deleteMany({ tournamentid: TournamentId }),
      BackboneUser.updateMany(
        { [`Tournaments.${TournamentId}`]: { $exists: true } },
        { $unset: { [`Tournaments.${TournamentId}`]: "" } }
      ),
      Tournament.deleteOne({ TournamentId }),
    ]);
  }

  public static async Start(): Promise<void> {
    if (this.IsRunning) return;
    this.IsRunning = true;
    msg("[Cleaner] Tournament cleaner started.");

    while (this.IsRunning) {
      try {
        await this.Clean();
      } catch (err) {
        warn(`[Cleaner] Unexpected error: ${err}`);
      }
      await new Promise((r) => setTimeout(r, CLEANUP_INTERVAL_MS));
    }
  }

  public static Stop(): void {
    this.IsRunning = false;
    msg("[Cleaner] Tournament cleaner stopped.");
  }
}
