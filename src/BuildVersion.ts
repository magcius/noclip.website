
//@ts-ignore
export const GIT_REVISION: string = __COMMIT_HASH;
export const GIT_SHORT_REVISION = GIT_REVISION.slice(0, 8);
export const GITHUB_URL = `https://github.com/magcius/noclip.website`;
export const GITHUB_REVISION_URL = `${GITHUB_URL}/commit/${GIT_REVISION}`;

//@ts-ignore
export const IS_DEVELOPMENT: boolean = process.env.NODE_ENV === 'development';
