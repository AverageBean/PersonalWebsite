"""Generate a two-part mold from an STL mesh using FreeCAD CSG.

Usage:
    FreeCADCmd generate-mold-with-freecad.py <input.stl> <output_dir> <params.json>

params.json:
    {
        "wallThickness": 10,
        "clearance": 0,
        "splitHeight": 25.5,
        "pinDiameter": 5,
        "pinInset": 8,
        "sprueDiameter": 6
    }

Outputs two STL files in output_dir and prints JSON to stdout:
    {"top": "<path>", "bottom": "<path>"}
"""

import json
import os
import sys


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


# ── CLI args ────────────────────────────────────────────────────────────────

if len(sys.argv) != 4:
    fail("Usage: FreeCADCmd generate-mold-with-freecad.py <input.stl> <output_dir> <params.json>")

input_path = os.path.abspath(sys.argv[1])
output_dir = os.path.abspath(sys.argv[2])
params_path = os.path.abspath(sys.argv[3])

if not os.path.exists(input_path):
    fail(f"Input file does not exist: {input_path}")
if not os.path.isdir(output_dir):
    fail(f"Output directory does not exist: {output_dir}")
if not os.path.exists(params_path):
    fail(f"Params file does not exist: {params_path}")

with open(params_path, "r") as f:
    params = json.load(f)

wall = float(params.get("wallThickness", 10))
clearance = float(params.get("clearance", 0))
split_y = float(params["splitHeight"])
pin_dia = float(params.get("pinDiameter", 5))
pin_inset = float(params.get("pinInset", 8))
pin_tolerance = float(params.get("pinTolerance", 0.4))
sprue_dia = float(params.get("sprueDiameter", 6))
sprue_enabled = params.get("sprueEnabled", True)

if wall <= 0:
    fail("wallThickness must be positive")
if pin_dia <= 0:
    fail("pinDiameter must be positive")

# ── FreeCAD imports ─────────────────────────────────────────────────────────

try:
    import FreeCAD
    import Mesh
    import Part
    import MeshPart
except Exception as exc:
    fail(f"FreeCAD modules are unavailable: {exc}")


DOC_NAME = "MOLD_GEN"

try:
    doc = FreeCAD.newDocument(DOC_NAME)

    # ── 1. Load STL and convert to solid ────────────────────────────────────

    mesh = Mesh.Mesh(input_path)
    if mesh.CountFacets == 0:
        fail("The STL file contains no triangles.")

    shape = Part.Shape()
    shape.makeShapeFromMesh(mesh.Topology, 0.1)

    try:
        solid = Part.makeSolid(shape)
        model = solid if (solid and not solid.isNull()) else shape
    except Exception:
        model = shape

    if model is None or model.isNull():
        fail("Could not build valid geometry from the STL mesh.")

    # ── 2. Apply clearance offset (scale from centroid) ─────────────────────

    bb = model.BoundBox
    if clearance > 0:
        cx = (bb.XMin + bb.XMax) / 2.0
        cy = (bb.YMin + bb.YMax) / 2.0
        cz = (bb.ZMin + bb.ZMax) / 2.0
        sx = (bb.XLength + 2 * clearance) / bb.XLength if bb.XLength > 0.001 else 1.0
        sy = (bb.YLength + 2 * clearance) / bb.YLength if bb.YLength > 0.001 else 1.0
        sz = (bb.ZLength + 2 * clearance) / bb.ZLength if bb.ZLength > 0.001 else 1.0

        import FreeCAD as App
        mat = App.Matrix()
        # translate to origin, scale, translate back
        mat.move(App.Vector(-cx, -cy, -cz))
        scale_mat = App.Matrix()
        scale_mat.A11 = sx
        scale_mat.A22 = sy
        scale_mat.A33 = sz
        mat = scale_mat.multiply(mat)
        back = App.Matrix()
        back.move(App.Vector(cx, cy, cz))
        mat = back.multiply(mat)
        model = model.transformGeometry(mat)
        bb = model.BoundBox

    # ── 3. Create mold block ────────────────────────────────────────────────

    block_xmin = bb.XMin - wall
    block_ymin = bb.YMin - wall
    block_zmin = bb.ZMin - wall
    block_xlen = bb.XLength + 2 * wall
    block_ylen = bb.YLength + 2 * wall
    block_zlen = bb.ZLength + 2 * wall

    block = Part.makeBox(
        block_xlen, block_ylen, block_zlen,
        FreeCAD.Vector(block_xmin, block_ymin, block_zmin)
    )

    # ── 4. Boolean subtract model from block ────────────────────────────────

    print("[mold] Subtracting model from block...", file=sys.stderr)
    mold = block.cut(model)
    if mold.isNull():
        fail("Boolean subtraction failed — model may have invalid geometry.")

    # ── 5. Bisect into top and bottom halves ────────────────────────────────

    # Clamp split height to model bounds
    split_y = max(bb.YMin + 0.1, min(bb.YMax - 0.1, split_y))

    # Oversized slabs for clean cuts (extend well beyond mold bounds)
    slab_margin = max(block_xlen, block_zlen) + 10
    slab_thickness = block_ylen + 2 * wall + 10

    # Lower slab: from well below block bottom to split_y
    lower_slab = Part.makeBox(
        block_xlen + 2 * slab_margin,
        split_y - (block_ymin - 5),
        block_zlen + 2 * slab_margin,
        FreeCAD.Vector(block_xmin - slab_margin, block_ymin - 5, block_zmin - slab_margin)
    )

    # Upper slab: from split_y to well above block top
    upper_slab = Part.makeBox(
        block_xlen + 2 * slab_margin,
        (block_ymin + block_ylen + 5) - split_y,
        block_zlen + 2 * slab_margin,
        FreeCAD.Vector(block_xmin - slab_margin, split_y, block_zmin - slab_margin)
    )

    print("[mold] Bisecting mold...", file=sys.stderr)
    bottom_half = mold.cut(upper_slab)
    top_half = mold.cut(lower_slab)

    if bottom_half.isNull() or top_half.isNull():
        fail("Bisection cut failed.")

    # ── 6. Registration pins and holes ──────────────────────────────────────

    pin_height = pin_dia * 1.5
    pin_radius = (pin_dia - pin_tolerance) / 2.0  # peg undersized by tolerance
    hole_radius = pin_dia / 2.0  # hole at nominal diameter

    # Pin positions: 4 corners of the parting face, inset from mold block edges
    pin_positions = [
        (block_xmin + pin_inset, block_zmin + pin_inset),
        (block_xmin + block_xlen - pin_inset, block_zmin + pin_inset),
        (block_xmin + pin_inset, block_zmin + block_zlen - pin_inset),
        (block_xmin + block_xlen - pin_inset, block_zmin + block_zlen - pin_inset),
    ]

    print("[mold] Adding registration pins and holes...", file=sys.stderr)
    for (px, pz) in pin_positions:
        # Pin protrudes upward from bottom half's parting face
        pin = Part.makeCylinder(
            pin_radius,
            pin_height,
            FreeCAD.Vector(px, split_y - pin_height / 2.0, pz),
            FreeCAD.Vector(0, 1, 0)  # Y-up axis
        )
        bottom_half = bottom_half.fuse(pin)

        # Matching hole in top half (slightly larger for fit)
        hole = Part.makeCylinder(
            hole_radius,
            pin_height + 0.5,  # slightly deeper than pin
            FreeCAD.Vector(px, split_y - pin_height / 2.0 - 0.25, pz),
            FreeCAD.Vector(0, 1, 0)
        )
        top_half = top_half.cut(hole)

    # ── 7. Sprue channel ───────────────────────────────────────────────────

    if sprue_enabled:
        # Place the sprue above actual model material, not at the bounding box
        # centroid (which may be empty, e.g. hollow ring center).
        # Strategy: find the mesh vertex with the highest Y coordinate —
        # its XZ position is guaranteed to be above solid material.
        sprue_x = (bb.XMin + bb.XMax) / 2.0  # fallback
        sprue_z = (bb.ZMin + bb.ZMax) / 2.0
        vertices = mesh.Points
        if vertices:
            top_vertex = max(vertices, key=lambda v: v.y)
            sprue_x = top_vertex.x
            sprue_z = top_vertex.z
            print(f"[mold] Sprue placed at top vertex: X={sprue_x:.1f}, Z={sprue_z:.1f}", file=sys.stderr)

        sprue_height = (block_ymin + block_ylen) - split_y + 1.0  # through to top + margin

        print("[mold] Adding sprue channel...", file=sys.stderr)
        sprue = Part.makeCylinder(
            sprue_dia / 2.0,
            sprue_height,
            FreeCAD.Vector(sprue_x, split_y - 0.5, sprue_z),  # start just below split
            FreeCAD.Vector(0, 1, 0)
        )
        top_half = top_half.cut(sprue)
    else:
        print("[mold] Sprue disabled, skipping.", file=sys.stderr)

    # ── 8. Export as STL ────────────────────────────────────────────────────

    stem = os.path.splitext(os.path.basename(input_path))[0]
    top_path = os.path.join(output_dir, f"{stem}-mold-top.stl")
    bottom_path = os.path.join(output_dir, f"{stem}-mold-bottom.stl")

    print("[mold] Exporting halves...", file=sys.stderr)

    # Convert Part shapes to Mesh for STL export
    top_mesh = MeshPart.meshFromShape(top_half, LinearDeflection=0.1, AngularDeflection=0.5)
    bottom_mesh = MeshPart.meshFromShape(bottom_half, LinearDeflection=0.1, AngularDeflection=0.5)

    top_mesh.write(top_path)
    bottom_mesh.write(bottom_path)

    if not os.path.exists(top_path):
        fail("Failed to write top half STL.")
    if not os.path.exists(bottom_path):
        fail("Failed to write bottom half STL.")

    # Report file sizes
    top_size = os.path.getsize(top_path)
    bottom_size = os.path.getsize(bottom_path)
    print(f"[mold] top: {top_size} bytes, bottom: {bottom_size} bytes", file=sys.stderr)

    # Stdout JSON for the server to parse
    result = json.dumps({"top": top_path, "bottom": bottom_path})
    print(result)

except SystemExit:
    raise
except Exception as exc:
    fail(f"Mold generation failed: {exc}")
finally:
    try:
        FreeCAD.closeDocument(DOC_NAME)
    except Exception:
        pass
