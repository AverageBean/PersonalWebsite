import os
import sys


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


if len(sys.argv) != 3:
    fail("Usage: FreeCADCmd convert-sldprt-with-freecad.py <input.sldprt> <output.stl>")

input_path = os.path.abspath(sys.argv[1])
output_path = os.path.abspath(sys.argv[2])

if not os.path.exists(input_path):
    fail(f"Input file does not exist: {input_path}")

try:
    import FreeCAD
    import Import
    import Mesh
except Exception as exc:
    fail(f"FreeCAD modules are unavailable: {exc}")


doc_name = "SLDPRT_CONVERSION"

try:
    doc = FreeCAD.newDocument(doc_name)

    try:
        Import.insert(input_path, doc.Name)
    except Exception as exc:
        fail(
            "FreeCAD could not import this SLDPRT file. "
            f"This FreeCAD build likely lacks SLDPRT support ({exc})."
        )

    export_objects = []
    for obj in doc.Objects:
        if hasattr(obj, "Shape") and obj.Shape and not obj.Shape.isNull():
            export_objects.append(obj)

    if not export_objects:
        fail("No valid solid geometry was found in the SLDPRT file.")

    Mesh.export(export_objects, output_path)

    if not os.path.exists(output_path):
        fail("FreeCAD did not write the STL output.")

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
