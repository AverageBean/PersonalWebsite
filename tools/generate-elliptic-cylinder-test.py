"""
Generate a synthetic elliptic-cylinder STL for Phase C-1 testing.

Creates an axis-aligned (Z-extruded) elliptic cylinder:
  - semi-axis a (along X) = 10 mm
  - semi-axis b (along Y) = 6 mm
  - height (along Z)      = 30 mm

Expected volume: pi * a * b * h = pi * 10 * 6 * 30 ≈ 5654.87 mm^3.

Run with FreeCAD's Python:
    "C:/Program Files/FreeCAD 1.0/bin/python.exe" \
        tools/generate-elliptic-cylinder-test.py

Writes: TestDocs/EllipticCylinder.stl
"""

import os
import sys

import FreeCAD
import Part
import Mesh

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT    = os.path.join(REPO_ROOT, "TestDocs", "EllipticCylinder.stl")

# Ellipse parameters
SEMI_A = 10.0   # mm — along X
SEMI_B =  6.0   # mm — along Y
HEIGHT = 30.0   # mm — extrusion along Z

# Mesh tessellation tolerance (smaller = finer; smaller mesh files load faster
# in tests). 0.1 mm gives ~250 facets on the ellipse perimeter, which is
# enough for the detector to fit the ellipse to <0.1mm residual.
MESH_TOLERANCE = 0.1

doc = FreeCAD.newDocument("EllipticCylinderTest")
try:
    # Build the ellipse curve in the XY plane
    ellipse = Part.Ellipse(
        FreeCAD.Vector(0, 0, 0),  # centre
        SEMI_A,                    # major radius
        SEMI_B,                    # minor radius
    )
    edge = ellipse.toShape()
    wire = Part.Wire([edge])
    face = Part.Face(wire)

    # Extrude along +Z by HEIGHT
    solid = face.extrude(FreeCAD.Vector(0, 0, HEIGHT))

    feat = doc.addObject("Part::Feature", "EllipticCylinder")
    feat.Shape = solid
    doc.recompute()

    # Tessellate to STL
    mesh = Mesh.Mesh()
    mesh.addFacets(feat.Shape.tessellate(MESH_TOLERANCE))
    mesh.write(OUTPUT)

    n_facets = mesh.CountFacets
    vol = solid.Volume
    print(f"Wrote {OUTPUT}", flush=True)
    print(f"  semi-axes:     {SEMI_A} mm × {SEMI_B} mm", flush=True)
    print(f"  height:        {HEIGHT} mm", flush=True)
    print(f"  exact volume:  {vol:.3f} mm³", flush=True)
    print(f"  facet count:   {n_facets}", flush=True)
    print(f"  bbox:          {solid.BoundBox}", flush=True)

finally:
    FreeCAD.closeDocument(doc.Name)
