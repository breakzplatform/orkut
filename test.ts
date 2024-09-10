import { AppBskyActorDefs, ComAtprotoLabelDefs } from "@atproto/api";
import {
  DID,
  PORT,
  LABEL_LIMIT,
  POSTS,
  SIGNING_KEY,
  // DELETE,
} from "./src/constants.js";
import { LabelerServer } from "@skyware/labeler";

const server = new LabelerServer({ did: DID, signingKey: SIGNING_KEY });

server.start(PORT, (error, address) => {
  if (error) {
    console.error(error);
  } else {
//    console.log(`Labeler server listening on ${address}`);
   
    (async () => {
	await server
      .createLabels({ uri: 'did:plc:uorsid6pyxlcoggl3b65mzfy' }, { negate: ['s'] })
      .catch((err) => {
        console.log(err);
      })
      .then(() => console.log(`Deleted label`));
})();

//console.log('foi'); 
  }
});
