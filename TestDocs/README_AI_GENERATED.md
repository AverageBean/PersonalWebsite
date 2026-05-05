# AI-Generated Synthetic Test Assets

Files in this directory prefixed `AIgen_` are **synthetic** — produced by a
generator script in `tools/`, not captured from real CAD work or scanned
hardware. They exist to exercise specific code paths in the parametric STEP
converter that no real-world TestDocs asset reaches yet.

Treat them as test fixtures, not as ground-truth geometry.

## Asset registry

| File | Generator | Purpose |
|------|-----------|---------|
| `AIgen_EllipticCylinder.stl` | `tools/generate-elliptic-cylinder-test.py` | Phase C-1 regression: ellipse a=10 mm, b=6 mm, extruded h=30 mm along +Z. Exercises `detect_elliptic_cylinders` + `build_elliptic_cylinder_solid`. |
| `AIgen_RevolvedOgive.stl` | `tools/generate-revolved-profile-test.py` | Phase C-2 regression: vase profile (6-point B-spline through (12,11,7,6,9,4) mm radii at z=0..30 mm) revolved 360° around Z. ASCII STL — header is `solid AIgen_RevolvedOgive`. Exercises `find_revolution_axis` + `extract_profile` + `build_revolution_solid`. |

## Convention

- Filename prefix: `AIgen_`
- Generator script lives in `tools/` and writes to `TestDocs/` directly
- Generator script docstring opens with a line stating the asset is AI-generated
- ASCII-STL `solid` header should match the `AIgen_<Name>` filename stem
- Add an entry to the table above when introducing a new synthetic asset

## Why label these explicitly

The converter pipeline detects geometric primitives by RANSAC against face
samples. A synthetic STL produced by extruding/revolving a known curve in
FreeCAD has perfectly clean normals — every face on the lateral surface lies
exactly on the analytic primitive. Real STLs from Onshape/SolidWorks export
have subtler quantisation and chord-error noise.

If the detector only ever sees synthetic test assets, it can pass with
threshold values that would never tolerate a real export. Keeping AI-generated
assets visibly labelled prevents anyone (the user, future Claude sessions,
the parametric runtime) from mistaking them for real-world fidelity proofs.
