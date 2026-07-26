/**
 * The print agent's browser library ships no types. Only the module shape is
 * declared here; `components/print/print-provider.tsx` narrows it to a local
 * `Qz` type, so a typo in a call name is still a compile error there.
 */
declare module "qz-tray" {
  const qz: unknown
  export default qz
}
