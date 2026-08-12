# Migration-only source

Code under this directory is intentionally excluded from the Cocos `assets/`
graph and from release bundles. It is retained only while an external product
boundary is being decided.

Rules:

- Do not add Cocos `.meta` files here.
- Runtime code under `assets/` must not import this directory.
- Keep retained TypeScript healthy with `pnpm typecheck:migration` on a machine
  where Cocos Creator 3.8.8 has generated `temp` declarations.
- Move a feature back into `assets/` only with an explicit product entry point,
  ownership boundary, runtime tests, and bundle review.
