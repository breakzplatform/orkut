import { AppBskyActorDefs, ComAtprotoLabelDefs } from "@atproto/api";
import {
  DID,
  PORT,
  SIGNING_KEY,
  RUN,
  DELETE,
} from "./constants.js";
import { LabelerServer } from "@skyware/labeler";

const server = new LabelerServer({ did: DID, signingKey: SIGNING_KEY });

server.start(PORT, (error, address) => {
  if (error) {
    console.error(error);
  } else {
    console.log(`Labeler server listening on ${address}`);
  }
});

export const label = async (
  subject: string | AppBskyActorDefs.ProfileView,
  rkey: string
) => {
  const did = AppBskyActorDefs.isProfileView(subject) ? subject.did : subject;

  const query = server.db
    .prepare<unknown[], ComAtprotoLabelDefs.Label>(
      `SELECT * FROM labels WHERE uri = ?`
    )
    .all(did);

  const labels = query.reduce((set, label) => {
    if (!label.neg) set.add(label.val);
    else set.delete(label.val);
    return set;
  }, new Set<string>());

  if (rkey.includes(DELETE)) {
    await server
      .createLabels({ uri: did }, { negate: [...labels] })
      .catch((err) => {
        console.log(err);
      })
      .then(() => console.log(`Deleted labels for ${did}`));
  } else if (rkey.includes(RUN)) {
    const shuffledArray = ["", "muito", "super"].sort(() => Math.random() - 0.5);
    if (did === "did:plc:uorsid6pyxlcoggl3b65mzfy" || did == "did:plc:6objvq5gprmuleio2qudohtn") {
      await server
        .createLabel({ uri: did, val: "superconfiavel" })
        .catch((err) => {
          console.log(err);
        })
        .then(() => console.log("eu", "superconfiavel"));

      await server
        .createLabel({ uri: did, val: "superlegal" })
        .catch((err) => {
          console.log(err);
        })
        .then(() => console.log("eu", "superlegal"));

      await server
        .createLabel({ uri: did, val: "supersexy" })
        .catch((err) => {
          console.log(err);
        })
        .then(() => console.log("eu", "supersexy"));
    } else if (did === "did:plc:awzk6kvwtzhvr2bk3sinxwe2") {
      await server
        .createLabel({ uri: did, val: "superconfiavel" })
        .catch((err) => {
          console.log(err);
        })

      await server
        .createLabel({ uri: did, val: "superlegal" })
        .catch((err) => {
          console.log(err);
        })

      await server
        .createLabel({ uri: did, val: "syngred" })
        .catch((err) => {
          console.log(err);
        })
    } else {
      await server
        .createLabel({ uri: did, val: `${shuffledArray[0]}confiavel` })
        .catch((err) => {
          console.log(err);
        })
        .then(() => console.log(`Labeled ${did} with ${`${shuffledArray[0]}confiavel`}`));

        await server
        .createLabel({ uri: did, val: `${shuffledArray[1]}legal` })
        .catch((err) => {
          console.log(err);
        })
        .then(() => console.log(`Labeled ${did} with ${`${shuffledArray[1]}legal`}`));
      
        await server
        .createLabel({ uri: did, val: `${shuffledArray[2]}sexy` })
        .catch((err) => {
          console.log(err);
        })
        .then(() => console.log(`Labeled ${did} with ${`${shuffledArray[2]}sexy`}`));
    }
  }
};
