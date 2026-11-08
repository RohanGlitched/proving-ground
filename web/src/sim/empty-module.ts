// Browser stand-in for Node's 'module' builtin. @mujoco/mujoco only imports it inside its Node branch,
// which never runs in a browser or worker; Turbopack still has to resolve the specifier.
export const createRequire = () => {
  throw new Error("createRequire is not available in the browser");
};
export default { createRequire };
