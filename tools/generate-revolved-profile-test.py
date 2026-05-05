"""
Generate a synthetic surface-of-revolution STL for Phase C-2 testing.

This is an AI-GENERATED synthetic asset — not captured ground truth.
Listed in TestDocs/README_AI_GENERATED.md.

Builds a vase-shaped solid by revolving a B-spline profile 360 degrees
around the Z axis. The profile passes through 6 control (r, z) points:

    (12, 0)   base outer rim
    (11, 5)
    ( 7, 12)  narrow waist
    ( 6, 18)
    ( 9, 24)  shoulder
    ( 4, 30)  top opening

Profile is closed by a straight edge down the axis (from (4, 30) to (0, 30)
to (0, 0)) and back out to (12, 0).

The result has no flat lateral faces — every side face lies on the
revolved B-spline, which Phase C-2 should reconstruct as a single
SURFACE_OF_REVOLUTION over a B_SPLINE_CURVE_WITH_KNOTS profile.

Run with FreeCAD's Python:
    "C:/Program Files/FreeCAD 1.0/bin/python.exe" \
        tools/generate-revolved-profile-test.py

Writes: TestDocs/AIgen_RevolvedOgive.stl  (ASCII STL — header readable)
"""

import os
import sys

import FreeCAD
import Part
import Mesh

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT    = os.path.join(REPO_ROOT, "TestDocs", "AIgen_RevolvedOgive.stl")

# Profile control points (r, z) — must be in XZ plane with x = r >= 0.
# Listed in order from base to top; reverse closure traces axis back down.
PROFILE_RZ = [
    (12.0,  0.0),
    (11.0,  5.0),
    ( 7.0, 12.0),
    ( 6.0, 18.0),
    ( 9.0, 24.0),
    ( 4.0, 30.0),
]

# Mesh tessellation — finer = larger file but more accurate shape for the
# detector to fit. 0.05 mm gives ~5000 facets for a 30 mm tall vase.
MESH_TOLERANCE = 0.05

# Revolution axis (Z) and origin
AXIS_DIR    = FreeCAD.Vector(0.0, 0.0, 1.0)
AXIS_ORIGIN = FreeCAD.Vector(0.0, 0.0, 0.0)


def build_profile_face():
    """Build a closed wire in the XZ plane and convert to a Face."""
    # B-spline through the (r, z) points (mapped into X=r, Y=0, Z=z space)
    profile_pts = [FreeCAD.Vector(r, 0.0, z) for r, z in PROFILE_RZ]
    bspline = Part.BSplineCurve()
    bspline.interpolate(profile_pts)
    profile_edge = bspline.toShape()

    # Closing edges to the Z axis
    top_outer    = FreeCAD.Vector(PROFILE_RZ[-1][0], 0.0, PROFILE_RZ[-1][1])
    top_axis     = FreeCAD.Vector(0.0, 0.0, PROFILE_RZ[-1][1])
    bottom_axis  = FreeCAD.Vector(0.0, 0.0, PROFILE_RZ[0][1])
    bottom_outer = FreeCAD.Vector(PROFILE_RZ[0][0], 0.0, PROFILE_RZ[0][1])

    top_edge    = Part.LineSegment(top_outer, top_axis).toShape()
    axis_edge   = Part.LineSegment(top_axis, bottom_axis).toShape()
    bottom_edge = Part.LineSegment(bottom_axis, bottom_outer).toShape()

    wire = Part.Wire([profile_edge, top_edge, axis_edge, bottom_edge])
    if not wire.isClosed():
        raise RuntimeError("profile wire failed to close")
    return Part.Face(wire)


doc = FreeCAD.newDocument("RevolvedOgiveTest")
try:
    profile_face = build_profile_face()

    # Revolve 360 around Z
    solid = profile_face.revolve(AXIS_ORIGIN, AXIS_DIR, 360.0)
    if not solid.isValid():
        raise RuntimeError("revolved solid is not valid")

    feat = doc.addObject("Part::Feature", "AIgen_RevolvedOgive")
    feat.Shape = solid
    doc.recompute()

    # Tessellate to ASCII STL so the `solid AIgen_RevolvedOgive` header is
    # human-readable when grepped or opened in a text editor.
    mesh = Mesh.Mesh()
    mesh.addFacets(feat.Shape.tessellate(MESH_TOLERANCE))
    mesh.write(OUTPUT, "AST")  # AST = ASCII STL

    # FreeCAD writes `solid Mesh` and `endsolid Mesh` regardless of the Part
    # feature label. Patch both header and footer so the asset is
    # self-describing when grepped or opened in a text editor.
    asset_label = "AIgen_RevolvedOgive"
    with open(OUTPUT, "r", encoding="ascii", errors="replace") as f:
        contents = f.read()
    contents = contents.replace("solid Mesh", f"solid {asset_label}", 1)
    contents = contents.replace("endsolid Mesh", f"endsolid {asset_label}")
    with open(OUTPUT, "w", encoding="ascii") as f:
        f.write(contents)

    n_facets = mesh.CountFacets
    vol = solid.Volume
    print(f"Wrote {OUTPUT}", flush=True)
    print(f"  profile (r, z): {PROFILE_RZ}", flush=True)
    print(f"  mesh tolerance: {MESH_TOLERANCE} mm", flush=True)
    print(f"  exact volume:   {vol:.3f} mm^3", flush=True)
    print(f"  facet count:    {n_facets}", flush=True)
    print(f"  bbox:           {solid.BoundBox}", flush=True)

    # Verify the patched header is in place
    with open(OUTPUT, "r", encoding="ascii", errors="replace") as f:
        first = f.readline().strip()
    print(f"  STL header:     {first}", flush=True)

finally:
    FreeCAD.closeDocument(doc.Name)
