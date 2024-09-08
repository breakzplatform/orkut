import "dotenv/config";

export const DID = process.env.DID ?? "";
export const SIGNING_KEY = process.env.SIGNING_KEY ?? "";
export const PORT = 4001;
export const LABEL_LIMIT = 4;
// export const DELETE = "3kwsqucto3j2a";
export const POSTS: Record<string, string> = {
  "3l3mj73boda2l": "super",
};
