import e, { NextFunction, Request, Response } from "express";
import fs from "fs/promises";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { BODY_SIZE_LIMIT, IS_DEBUG, PORT, PROJECT_NAME } from "../Modules/Constants";
import { msg, warn, toGradient } from "../Modules/Logger";
import { gray, italic, magenta, red } from "colorette";
import { E_NotFound, E_ServerError } from "../Modules/Errors";
import { GeneratePrizepoolId, Register } from "../Modules/Extensions";
import mongoose from "mongoose";
import { CreateTournament } from "./Database";
import { Emotes, IS_MAINTENANCE, Scenes, TournamentPhaseType } from "../Backbone/Config";
import { Tournament } from "../Models/Tournament";
import { StartLoop } from "../Backbone/Logic/Internal/Resolving";
import { Bot } from "./Bot";
import { TournamentScheduler } from "./Scheduler";
import { TournamentCleaner } from "./Deleter";
import { SendDownloadWebMessage } from "../Modules/DownloadWebMessage";

// ─── GLOBAL RATE LIMITER ─────────────────────────────────────────────────────
const GlobalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." },
});

export const App = e()
  .disable("etag")
  .disable("x-powered-by")
  .use(helmet({ contentSecurityPolicy: false }))
  .use(e.json({ limit: BODY_SIZE_LIMIT }))
  .use(e.urlencoded({ limit: BODY_SIZE_LIMIT, extended: false }))
  .use(cors({ origin: "*" }))
  .use(GlobalLimiter);

function MakeGradient(): [string, string] {
  const BaseHue = Math.floor(Math.random() * 360);
  const BaseSaturation = 70 + Math.random() * 20;
  const BaseLightness = 50 + Math.random() * 15;
  const EndHue = (BaseHue + 15 + Math.random() * 30) % 360;
  const EndSaturation = BaseSaturation + (Math.random() * 10 - 5);
  const EndLightness = BaseLightness + (Math.random() * 20 - 10);
  return [ConvertToHex(BaseHue, BaseSaturation, BaseLightness), ConvertToHex(EndHue, EndSaturation, EndLightness)];
}

function ConvertToHex(H: number, S: number, L: number): string {
  const Saturation = S / 100;
  const Lightness = L / 100;
  const C = (1 - Math.abs(2 * Lightness - 1)) * Saturation;
  const X = C * (1 - Math.abs(((H / 60) % 2) - 1));
  const M = Lightness - C / 2;
  let R = 0, G = 0, B = 0;
  if (H >= 0 && H < 60)        { R = C; G = X; B = 0; }
  else if (H >= 60 && H < 120) { R = X; G = C; B = 0; }
  else if (H >= 120 && H < 180){ R = 0; G = C; B = X; }
  else if (H >= 180 && H < 240){ R = 0; G = X; B = C; }
  else if (H >= 240 && H < 300){ R = X; G = 0; B = C; }
  else                          { R = C; G = 0; B = X; }
  const ToHex = (V: number) => Math.round((V + M) * 255).toString(16).padStart(2, "0");
  return `#${ToHex(R)}${ToHex(G)}${ToHex(B)}`;
}

async function LoadRoutes(
  Dir: string,
  Routes: Array<{ Path: string; Module: any }> = []
): Promise<Array<{ Path: string; Module: any }>> {
  const Entries = await fs.readdir(Dir, { withFileTypes: true });
  await Promise.all(
    Entries.map(async (Entry) => {
      const FullPath = path.join(Dir, Entry.name);
      if (Entry.isDirectory()) {
        await LoadRoutes(FullPath, Routes);
      } else if (Entry.isFile() && (Entry.name.endsWith(".ts") || Entry.name.endsWith(".js"))) {
        try {
          const Module = await import(path.resolve(FullPath));
          if (Module.default?.App) {
            Routes.push({ Path: Entry.name, Module: Module.default });
          }
        } catch (Err) {
          warn(`Failed loading ${italic(Entry.name)}: ${(Err as Error).message}`);
        }
      }
    })
  );
  return Routes;
}

async function Start() {
  const RoutesDir = path.join(".", Symbol.for("ts-node.register.instance") in process ? "Source" : "bin", "Routes");

  const [, RoutesList] = await Promise.all([
    mongoose.connect(process.env.DATABASE_URI || "", {
      tls: true,
      tlsAllowInvalidCertificates: true,
      rejectUnauthorized: false,
      heartbeatFrequencyMS: 10000,
      family: 4,
    }),
    LoadRoutes(RoutesDir),
  ]);

  // ─── MAINTENANCE MIDDLEWARE ───────────────────────────────────────────────
  App.use((Req: Request, Res: Response, Next: NextFunction) => {
    if (IS_MAINTENANCE) {
      return Res.status(503).json({
        message: "Servers are currently on maintenance. Please try again later.",
      });
    }
    Next();
  });

  App.use(Register);

  for (const { Path, Module } of RoutesList) {
    const MountPath = Module.DefaultAPI || "/";
    App.use(MountPath, Module.App);
    const [Start, End] = MakeGradient();
    msg(`Loaded ${italic(toGradient(Path, Start, End))}`);
  }

  App.use((Req, Res) => Res.error(E_NotFound, Req.path));
  App.use((Err: Error, Req: Request, Res: Response, _Next: NextFunction) => {
    console.error(Err);
    Res.error(E_ServerError);
  });

  msg(`Connected to ${gray(PROJECT_NAME)} database`);

  // ─── BOT LOGIN ────────────────────────────────────────────────────────────
  const botToken = process.env.BOT_TOKEN;
  if (botToken) {
    await Bot.login(botToken);
  } else {
    warn("BOT_TOKEN not set — Discord bot will not start.");
  }

  App.listen(PORT, () => {
    const [Start, End] = MakeGradient();
    StartLoop();
    msg(
      `${toGradient(PROJECT_NAME, Start, End)} running on port ${magenta(PORT.toString())} ${
        IS_DEBUG ? red("(debug)") : ""
      }`
    );
    SendDownloadWebMessage();
  });

  // ─── DEMO TOURNAMENT ─────────────────────────────────────────────────────
  // يُنشأ فقط إذا كان CREATE_DEMO_TOURNAMENT=true في .env
  if (process.env.CREATE_DEMO_TOURNAMENT === "true") {
    const StartTime = new Date(Date.now() + 15 * 60 * 1000);
    const TourId = Date.now().toString();
    
    // ✅ يمكنك تغيير PartySize هنا: 1 للـ 1v1، 2 للـ 2v2
    const PARTY_SIZE = 1; // غير هذا الرقم لـ 2 إذا تبي 2v2
    const MAX_INVITES = 4;

    // تحقق إن البطولة ما تنشأ مرتين بنفس الـ ID
    const existing = await Tournament.findOne({ TournamentId: TourId });
    if (!existing) {
      await CreateTournament({
        CurrentInvites: 0,
        MaxInvites: MAX_INVITES,
        TournamentId: TourId,
        TournamentName: `(.gg/stumble) ${PARTY_SIZE}v${PARTY_SIZE} Block Dash - SA`,
        TournamentImage: "https://i.ibb.co/VWBfzBZD/d59610fd5633c119ba851b71fe395905.jpg",
        TournamentColor: "#2D79C2",
        StartTime: StartTime,
        SignupStart: new Date(Date.now() + 1 * 60 * 1000),
        EntryFee: 0,
        PrizepoolId: GeneratePrizepoolId().toString(),
        PartySize: PARTY_SIZE,
        Status: 1,
        TournamentType: 0,
        Phases: [
          {
            PhaseType: TournamentPhaseType.SingleEliminationBracket,
            IsPhase: true,
            GroupCount: 1,
            RoundCount: 1,
            MaxTeams: Math.floor(MAX_INVITES / PARTY_SIZE),
            Maps: [Scenes["Block Dash"]],
          },
        ],
        Region: "menat",
        RoundCount: 2,
        CurrentPhaseId: 0,
        Properties: {
          IsInvitationOnly: false,
          InvitedIds: [],
          DisabledEmotes: [Emotes["Punch Only"]],
          AdminIds: [],
          StreamURL: "",
        },
        MinPlayersPerMatch: 1,
        MaxPlayersPerMatch: PARTY_SIZE * 2, // ✅ حساب تلقائي: 1v1 = 2، 2v2 = 4
        Prizes: [],
      });
      msg("Demo tournament created.");
    }
  }

  TournamentScheduler.Start();
  TournamentCleaner.Start();
}

Start().catch((Err) => {
  console.error("Tournament-SDK initialization failed:", Err);
  process.exit(1);
});

export { mongoose };
