/** Structural implementation of Clients' SkillRuntime port. */
export interface SkillRuntime {
  protocolVersion: 1;
  syncBundle(bundle: { skillId: string; revision: string; files: { path: string; data: Uint8Array<ArrayBuffer> }[] }): Promise<void>;
  executeScript(request: { skillId: string; revision: string; skillPath: string; scriptPath: string; args: string[] }): Promise<unknown>;
  retain(input: { skills: { skillId: string }[] }): Promise<void>;
}
