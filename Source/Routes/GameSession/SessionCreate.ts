import { Router } from "express";
import { ForService, ServiceType } from "../../Modules/Service";
import { XMLParser } from "fast-xml-parser";
import { Match } from "../../Models/Matches";

const App = Router();
App.use(ForService(ServiceType.Public));
// gonna add joi validation at some point

App.post("/gameSessionCreate", async (req, res) => {
  try {
    const { gameSessionData } = req.body;
    const AccessToken = req.body?.accessToken;

    if (!AccessToken || !gameSessionData) {
      return res.status(400).json({});
    }

    let DecodedXML: string;
    try {
      DecodedXML = Buffer.from(gameSessionData, "base64").toString("utf-8");
      if (!DecodedXML.trim().startsWith("<")) {
        DecodedXML = decodeURIComponent(gameSessionData);
      }
    } catch {
      return res.status(400).json({});
    }

    const Parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
      parseAttributeValue: true,
    });

    const ParsedXML = Parser.parse(DecodedXML);

    if (!ParsedXML?.data?.["game-session"]) {
      return res.status(400).json({});
    }

    const SessionData = ParsedXML.data["game-session"];
    const MatchId = SessionData["tournament-match-id"];
    const DatabaseMatch = await Match.findOne({ id: MatchId });

    if (!DatabaseMatch) {
      return res.status(404).json({});
    }

    const CheckedInUsers = DatabaseMatch.users.filter((u) => u["@checked-in"] === "1");
    const CheckedInTeams = new Set(CheckedInUsers.map((u) => u["@team-id"]).filter(Boolean));
    const TotalTeams = new Set(DatabaseMatch.users.map((u) => u["@team-id"]).filter(Boolean)).size;

    if (CheckedInTeams.size >= 2 || (TotalTeams > 0 && CheckedInTeams.size === TotalTeams)) {
      await Match.updateOne(
        { id: MatchId, status: { $in: [2, 1] } }, // GameReady=2 or WaitingForOpponent=1
        { $set: { status: 3 } } // GameInProgress=3
      );
    }

    const SessionId = parseInt(MatchId).toString();
    const Response = { id: SessionId };

    return res.status(200).json(Response);
  } catch {
    return res.status(500).json({});
  }
});

export default {
  App,
  DefaultAPI: "/api/v1",
};