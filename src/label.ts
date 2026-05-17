import { AppBskyActorDefs } from "@atproto/api";
import { DID, PORT, SIGNING_KEY, RUN, DELETE } from "./constants.js";
import { LabelerServer } from "@skyware/labeler";
import fs from "node:fs";

const server = new LabelerServer({ did: DID, signingKey: SIGNING_KEY });

server.start(PORT, (error, address) => {
  if (error) {
    console.error(error);
  } else {
    console.log(`Labeler server listening on ${address}`);
  }
});

const SUPPORTERS_FILE = "supporters.json";

type SupporterMap = Record<string, string[]>;

// Re-read on every event so editing supporters.json takes effect without a restart.
const loadSupporters = (): SupporterMap => {
  try {
    return JSON.parse(fs.readFileSync(SUPPORTERS_FILE, "utf8")) as SupporterMap;
  } catch (err) {
    console.error(`Could not read ${SUPPORTERS_FILE}:`, err);
    return {};
  }
};

const DEFAULT_PREFIXES = ["", "muito", "super"];
const DEFAULT_CATEGORIES = ["confiavel", "legal", "sexy"];
const DEFAULT_LABELS = new Set(
  DEFAULT_PREFIXES.flatMap((prefix) =>
    DEFAULT_CATEGORIES.map((category) => `${prefix}${category}`)
  )
);

const randomDefaultLabels = (): string[] => {
  const prefixes = [...DEFAULT_PREFIXES].sort(() => Math.random() - 0.5);
  return DEFAULT_CATEGORIES.map(
    (category, index) => `${prefixes[index]}${category}`
  );
};

const currentLabels = (did: string): Set<string> => {
  const rows = server.db
    .prepare(`SELECT val, neg FROM labels WHERE uri = ?`)
    .all(did) as Array<{ val: string; neg?: number | boolean }>;

  const set = new Set<string>();
  for (const row of rows) {
    if (row.neg) set.delete(row.val);
    else set.add(row.val);
  }
  return set;
};

const applyMissing = async (did: string, desired: string[], have: Set<string>) => {
  const missing = desired.filter((val) => !have.has(val));
  for (const val of missing) {
    try {
      await server.createLabel({ uri: did, val });
      console.log(`Labeled ${did} with ${val}`);
    } catch (err) {
      console.error(err);
    }
  }
};

export const label = async (
  subject: string | AppBskyActorDefs.ProfileView,
  rkey: string
) => {
  const did = AppBskyActorDefs.isProfileView(subject) ? subject.did : subject;
  const have = currentLabels(did);

  if (rkey.includes(DELETE)) {
    try {
      await server.createLabels({ uri: did }, { negate: [...have] });
      console.log(`Deleted labels for ${did}`);
    } catch (err) {
      console.error(err);
    }
    return;
  }

  if (!rkey.includes(RUN)) return;

  const supporters = loadSupporters();
  const supporterLabels = supporters[did];

  if (supporterLabels) {
    await applyMissing(did, supporterLabels, have);
    return;
  }

  // Idempotent: a default trio is assigned once and never stacked on re-likes.
  const alreadyAssigned = [...have].some((val) => DEFAULT_LABELS.has(val));
  if (alreadyAssigned) return;

  await applyMissing(did, randomDefaultLabels(), have);
};
