"""
Generic CAD → STL conversion using FreeCAD.

Supports STEP (.step, .stp), IGES (.iges, .igs), and BREP (.brep, .brp) files.
Runs under FreeCAD's Python interpreter (FreeCADCmd or python.exe with FreeCAD modules).

Usage: python convert-cad-to-stl-with-freecad.py <input.step> <output.stl>

Outputs to stdout: the output path on success.
Outputs to stderr + exits 1: descriptive error message on failure.
"""

import os
import sys


def fail(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


if len(sys.argv) != 3:
    fail(
        "Usage: python convert-cad-to-stl-with-freecad.py "
        "<input.step|.iges|.brep> <output.stl>"
    )

input_path = os.path.abspath(sys.argv[1])
output_path = os.path.abspath(sys.argv[2])

if not os.path.exists(input_path):
    fail(f"Input file does not exist: {input_path}")

ext = os.path.splitext(input_path)[1].lower()
SUPPORTED_EXTENSIONS = {".step", ".stp", ".iges", ".igs", ".brep", ".brp"}
if ext not in SUPPORTED_EXTENSIONS:
    fail(f"Unsupported file extension: {ext}. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}")

try:
    import FreeCAD
    import Part
    import Mesh as FcMesh
    import MeshPart
except ImportError as exc:
    fail(f"FreeCAD modules unavailable: {exc}")


doc_name = "CAD_TO_STL"

try:
    doc = FreeCAD.newDocument(doc_name)

    # Load the CAD file
    print(f"[cad-to-stl] loading {os.path.basename(input_path)} ...", flush=True)
    shape = Part.read(input_path)

    if shape.isNull():
        fail("FreeCAD could not read the CAD file (null shape).")

    # Tessellate with reasonable defaults
    # Linear deflection 0.1mm, angular deflection 0.5 radians (~28 degrees)
    print(f"[cad-to-stl] tessellating ...", flush=True)
    mesh = MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.1, AngularDeflection=0.5)

    if mesh.CountPoints == 0:
        fail("Tessellation produced no mesh points.")

    mesh.write(output_path)

    if not os.path.exists(output_path):
        fail("FreeCAD did not write the STL output file.")

    n_triangles = mesh.CountFacets
    print(f"[cad-to-stl] exported {n_triangles} triangles", flush=True)
    print(output_path, flush=True)

except SystemExit:
    raise
except Exception as exc:
    fail(f"CAD to STL conversion failed: {exc}")
finally:
    try:
        FreeCAD.closeDocument(doc_name)
    except Exception:
        pass
