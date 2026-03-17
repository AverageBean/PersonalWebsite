import os
import sys


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


if len(sys.argv) != 3:
    fail("Usage: FreeCADCmd convert-stl-to-step-with-freecad.py <input.stl> <output.step>")

input_path = os.path.abspath(sys.argv[1])
output_path = os.path.abspath(sys.argv[2])

if not os.path.exists(input_path):
    fail(f"Input file does not exist: {input_path}")

try:
    import FreeCAD
    import Mesh
    import Part
except Exception as exc:
    fail(f"FreeCAD modules are unavailable: {exc}")


doc_name = "STL_TO_STEP"

try:
    doc = FreeCAD.newDocument(doc_name)

    mesh = Mesh.Mesh(input_path)
    if mesh.CountFacets == 0:
        fail("The STL file contains no triangles.")

    # Build a Part shape from the mesh triangle topology.
    # Tolerance of 0.1 stitches edges that are within 0.1 model-units apart.
    shape = Part.Shape()
    shape.makeShapeFromMesh(mesh.Topology, 0.1)

    # Attempt to sew the shell into a closed solid.  If the mesh is not
    # watertight the solid will be null; in that case keep the shell so the
    # user still gets valid STEP geometry.
    try:
        solid = Part.makeSolid(shape)
        export_shape = solid if (solid and not solid.isNull()) else shape
    except Exception:
        export_shape = shape

    if export_shape is None or export_shape.isNull():
        fail("Could not build any valid geometry from the STL mesh.")

    part_feature = doc.addObject("Part::Feature", "Solid")
    part_feature.Shape = export_shape
    doc.recompute()

    Part.export([part_feature], output_path)

    if not os.path.exists(output_path):
        fail("FreeCAD did not write the STEP output.")

    print(output_path)

except SystemExit:
    raise
except Exception as exc:
    fail(f"Conversion failed: {exc}")
finally:
    try:
        FreeCAD.closeDocument(doc_name)
    except Exception:
        pass
