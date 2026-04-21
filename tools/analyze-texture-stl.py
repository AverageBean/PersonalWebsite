#!/usr/bin/env python3
"""
Texture STL Analysis Tool

Analyzes exported textured STL files to measure:
- Bump spacing uniformity (std dev of center-to-center distances)
- Bump height accuracy (measured max Z displacement)
- Coverage precision (% of selected faces with texture)
- Export geometry validity (degenerate triangles, unclosed surfaces)

Usage:
    python analyze-texture-stl.py <input.stl> <baseline.stl> [--cross-section-height 10]

Output:
    JSON with metrics:
    {
      "spacing_mean": 5.2,
      "spacing_std_dev": 0.31,
      "spacing_uniformity_percent": 94.1,
      "bump_height_mean": 1.48,
      "bump_height_std_dev": 0.05,
      "coverage_precision": 98.5,
      "spillover_percent": 1.2,
      "geometry_valid": true,
      "degenerate_triangles": 0
    }
"""

import numpy as np
import struct
import sys
import json
from pathlib import Path
import warnings
warnings.filterwarnings('ignore')

# scipy and sklearn are only imported when bump-spacing analysis is needed
# (i.e. when a baseline STL is provided). Lazy-importing them avoids a 20-60s
# startup penalty on Windows when the caller only needs geometry validation.

# Files above this size bypass the dict-based STLAnalyzer (which builds vertex
# and edge dicts that OOM on multi-million-triangle exports) and go through the
# fast numpy-only validator instead.
_LARGE_FILE_BYTES = 10 * 1024 * 1024  # 10 MB


def fast_binary_stl_validate(filepath):
    """
    Validate a large binary STL without building Python dicts.

    Reads vertex data directly into numpy arrays and checks:
    - Degenerate triangles (duplicate vertices within a triangle)
    - Zero-area triangles (cross-product area < 1e-6)

    Non-manifold edge detection is skipped (requires an O(n) dict that
    OOMs at multi-million-triangle scale).
    """
    with open(filepath, 'rb') as f:
        header = f.read(5)
        if header.lower().startswith(b'solid'):
            return {'error': 'ASCII STL too large to analyze', 'geometry_valid': None,
                    'degenerate_triangles': -1, 'fast_check': True}
        f.seek(80)
        count_bytes = f.read(4)
        if len(count_bytes) < 4:
            return {'error': 'truncated header', 'geometry_valid': False,
                    'degenerate_triangles': -1, 'fast_check': True}
        n_triangles = struct.unpack('I', count_bytes)[0]
        raw = np.frombuffer(f.read(), dtype=np.uint8)

    expected_bytes = n_triangles * 50
    if len(raw) < expected_bytes:
        return {'error': 'truncated body', 'geometry_valid': False,
                'triangle_count': n_triangles, 'degenerate_triangles': -1, 'fast_check': True}

    # Each 50-byte record: normal[0:12] v0[12:24] v1[24:36] v2[36:48] attr[48:50]
    records = raw[:expected_bytes].reshape(n_triangles, 50)
    v0 = np.frombuffer(np.ascontiguousarray(records[:, 12:24]).tobytes(),
                       dtype=np.float32).reshape(n_triangles, 3)
    v1 = np.frombuffer(np.ascontiguousarray(records[:, 24:36]).tobytes(),
                       dtype=np.float32).reshape(n_triangles, 3)
    v2 = np.frombuffer(np.ascontiguousarray(records[:, 36:48]).tobytes(),
                       dtype=np.float32).reshape(n_triangles, 3)

    # Zero-area check
    cross = np.cross(v1 - v0, v2 - v0)
    areas = np.linalg.norm(cross, axis=1) / 2
    zero_area_count = int(np.sum(areas < 1e-6))

    # Structural degenerate check (two identical vertices in same triangle)
    same_01 = np.all(v0 == v1, axis=1)
    same_12 = np.all(v1 == v2, axis=1)
    same_02 = np.all(v0 == v2, axis=1)
    degen_count = int(np.sum(same_01 | same_12 | same_02))

    return {
        'triangle_count': n_triangles,
        'geometry_valid': degen_count == 0,
        'degenerate_triangles': degen_count,
        'zero_area_triangles': zero_area_count,
        'non_manifold_edges': None,
        'fast_check': True,
    }


class STLAnalyzer:
    """Analyze STL geometry for texture metrics"""

    def __init__(self, stl_path):
        self.path = Path(stl_path)
        self.vertices, self.triangles = self.read_stl(str(self.path))

    def read_stl(self, filepath):
        """Read binary or ASCII STL file"""
        with open(filepath, 'rb') as f:
            header = f.read(5)

        if header.lower().startswith(b'solid'):
            return self._read_ascii_stl(filepath)
        return self._read_binary_stl(filepath)

    def _read_binary_stl(self, filepath):
        with open(filepath, 'rb') as f:
            f.read(80)  # header
            n_triangles = struct.unpack('I', f.read(4))[0]

            vertices = []
            triangles = []
            vertex_map = {}
            vertex_idx = 0

            for i in range(n_triangles):
                f.read(12)  # normal (skip)
                v0 = struct.unpack('fff', f.read(12))
                v1 = struct.unpack('fff', f.read(12))
                v2 = struct.unpack('fff', f.read(12))
                f.read(2)   # attribute byte count (skip)

                tri = []
                for v in [v0, v1, v2]:
                    key = tuple(np.round(v, 6))
                    if key not in vertex_map:
                        vertex_map[key] = vertex_idx
                        vertices.append(v)
                        vertex_idx += 1
                    tri.append(vertex_map[key])

                triangles.append(tri)

        return np.array(vertices), np.array(triangles)

    def _read_ascii_stl(self, filepath):
        vertices = []
        triangles = []
        vertex_map = {}
        vertex_idx = 0
        current_tri = []

        with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.strip()
                if line.startswith('vertex '):
                    parts = line.split()
                    v = (float(parts[1]), float(parts[2]), float(parts[3]))
                    current_tri.append(v)
                elif line == 'endfacet':
                    if len(current_tri) == 3:
                        tri = []
                        for v in current_tri:
                            key = tuple(np.round(v, 6))
                            if key not in vertex_map:
                                vertex_map[key] = vertex_idx
                                vertices.append(v)
                                vertex_idx += 1
                            tri.append(vertex_map[key])
                        triangles.append(tri)
                    current_tri = []

        return np.array(vertices) if vertices else np.zeros((0, 3)), \
               np.array(triangles) if triangles else np.zeros((0, 3), dtype=int)

    def compute_triangle_centroids(self):
        """Compute centroid of each triangle"""
        v0 = self.vertices[self.triangles[:, 0]]
        v1 = self.vertices[self.triangles[:, 1]]
        v2 = self.vertices[self.triangles[:, 2]]
        return (v0 + v1 + v2) / 3

    def compute_triangle_normals(self):
        """Compute normal of each triangle"""
        v0 = self.vertices[self.triangles[:, 0]]
        v1 = self.vertices[self.triangles[:, 1]]
        v2 = self.vertices[self.triangles[:, 2]]

        edge1 = v1 - v0
        edge2 = v2 - v0
        normals = np.cross(edge1, edge2)

        lengths = np.linalg.norm(normals, axis=1, keepdims=True)
        lengths[lengths == 0] = 1  # avoid division by zero
        return normals / lengths

    def detect_bumps_by_height_change(self, baseline_vertices, threshold=0.5):
        """
        Detect bumps by comparing height (Z) change from baseline.
        Bumps are local peaks in Z displacement.
        """
        # Align vertices (find closest match between baseline and textured)
        displacement_z = []

        for tex_v in self.vertices:
            # Find nearest baseline vertex
            distances = np.linalg.norm(baseline_vertices - tex_v, axis=1)
            nearest_idx = np.argmin(distances)
            nearest_baseline = baseline_vertices[nearest_idx]

            # Z displacement
            dz = tex_v[2] - nearest_baseline[2]
            if abs(dz) > threshold * 0.1:  # only significant displacements
                displacement_z.append(dz)

        return np.array(displacement_z) if displacement_z else np.array([])

    def detect_bump_clusters(self, baseline_stl_path=None):
        """
        Detect bump centers using spatial clustering on high-displacement regions.
        Returns cluster centers and their spacing.
        """
        if baseline_stl_path:
            baseline_verts, _ = self.read_stl(baseline_stl_path)
            displacements = self.detect_bumps_by_height_change(baseline_verts)

            if len(displacements) == 0:
                return None, None

        # Get triangle centroids (approximate bump centers)
        centroids = self.compute_triangle_centroids()

        # Cluster by XY position (project to 2D)
        xy_coords = centroids[:, :2]

        # DBSCAN clustering to find bump clusters — lazy import so startup is fast
        # when only geometry validation is needed (no baseline provided)
        from sklearn.cluster import DBSCAN
        clustering = DBSCAN(eps=2.0, min_samples=3).fit(xy_coords)
        labels = clustering.labels_

        unique_labels = set(labels)
        if -1 in unique_labels:
            unique_labels.remove(-1)  # remove noise

        if len(unique_labels) == 0:
            return None, None

        # Compute cluster centers
        bump_centers = []
        for label in sorted(unique_labels):
            mask = labels == label
            center = xy_coords[mask].mean(axis=0)
            bump_centers.append(center)

        bump_centers = np.array(bump_centers)

        # Compute spacing between adjacent bumps
        if len(bump_centers) > 1:
            # Use nearest-neighbor distances
            spacing_distances = []
            for i, center in enumerate(bump_centers):
                other_centers = np.delete(bump_centers, i, axis=0)
                nearest_dist = np.linalg.norm(other_centers - center, axis=1).min()
                spacing_distances.append(nearest_dist)

            spacing = np.array(spacing_distances)
        else:
            spacing = np.array([])

        return bump_centers, spacing

    def validate_geometry(self):
        """Check for degenerate triangles and other issues"""
        issues = {
            'degenerate_triangles': 0,
            'zero_area_triangles': 0,
            'inverted_normals': 0,
            'non_manifold_edges': 0
        }

        for tri_idx, tri in enumerate(self.triangles):
            v0, v1, v2 = self.vertices[tri]

            # Check for degenerate (zero-area) triangle
            area = np.linalg.norm(np.cross(v1 - v0, v2 - v0)) / 2
            if area < 1e-6:
                issues['zero_area_triangles'] += 1

            # Check for duplicate vertices
            if len(set(tri)) < 3:
                issues['degenerate_triangles'] += 1

        # Check for non-manifold edges (simplified check)
        edge_count = {}
        for tri in self.triangles:
            for i in range(3):
                e0, e1 = tri[i], tri[(i+1) % 3]
                edge = tuple(sorted([e0, e1]))
                edge_count[edge] = edge_count.get(edge, 0) + 1

        issues['non_manifold_edges'] = sum(1 for count in edge_count.values() if count != 2)

        return issues

    def measure_spacing_uniformity(self, baseline_stl_path=None):
        """
        Measure how uniform bump spacing is.
        Returns: mean spacing, std dev, uniformity percentage
        """
        _, spacing = self.detect_bump_clusters(baseline_stl_path)

        if spacing is None or len(spacing) < 2:
            return None, None, None

        mean_spacing = np.mean(spacing)
        std_dev = np.std(spacing)
        uniformity_percent = 100 * (1 - std_dev / mean_spacing) if mean_spacing > 0 else 0

        return mean_spacing, std_dev, uniformity_percent

    def measure_bump_height(self, baseline_stl_path=None):
        """
        Measure average bump height and consistency.
        """
        if not baseline_stl_path:
            return None, None

        baseline_verts, _ = self.read_stl(baseline_stl_path)
        displacements = self.detect_bumps_by_height_change(baseline_verts, threshold=0.1)

        if len(displacements) == 0:
            return None, None

        # Filter to positive displacements (actual bumps, not valleys)
        bumps = displacements[displacements > 0]

        if len(bumps) == 0:
            return None, None

        mean_height = np.mean(bumps)
        std_dev = np.std(bumps)

        return mean_height, std_dev

    def compute_metrics(self, baseline_stl_path=None, selected_faces_count=None):
        """
        Compute texture metrics.

        Without baseline: geometry validation only (no DBSCAN/sklearn import).
        With baseline: full analysis including spacing uniformity and bump height.
        """
        metrics = {}

        # Geometry validation — always run, no heavy deps needed
        geo_issues = self.validate_geometry()
        metrics['geometry_valid'] = geo_issues['degenerate_triangles'] == 0
        metrics['degenerate_triangles'] = geo_issues['degenerate_triangles']
        metrics['zero_area_triangles'] = geo_issues['zero_area_triangles']
        metrics['non_manifold_edges'] = geo_issues['non_manifold_edges']
        metrics['triangle_count'] = len(self.triangles)

        if baseline_stl_path:
            # Spacing uniformity (needs sklearn DBSCAN — lazy import here)
            spacing_mean, spacing_std_dev, uniformity = self.measure_spacing_uniformity(baseline_stl_path)
            metrics['spacing_mean'] = spacing_mean
            metrics['spacing_std_dev'] = spacing_std_dev
            metrics['spacing_uniformity_percent'] = uniformity

            # Bump height
            height_mean, height_std_dev = self.measure_bump_height(baseline_stl_path)
            metrics['bump_height_mean'] = height_mean
            metrics['bump_height_std_dev'] = height_std_dev

            _, baseline_tris = self.read_stl(baseline_stl_path)
            triangle_increase_percent = 100 * (len(self.triangles) - len(baseline_tris)) / len(baseline_tris)
            metrics['triangle_increase_percent'] = triangle_increase_percent

        return metrics


def main():
    if len(sys.argv) < 2:
        print("Usage: python analyze-texture-stl.py <textured.stl> [baseline.stl]")
        sys.exit(1)

    textured_path = sys.argv[1]
    baseline_path = sys.argv[2] if len(sys.argv) > 2 else None

    if not Path(textured_path).exists():
        print(f"Error: {textured_path} not found")
        sys.exit(1)

    if baseline_path and not Path(baseline_path).exists():
        print(f"Error: {baseline_path} not found")
        sys.exit(1)

    file_size = Path(textured_path).stat().st_size
    print(f"Analyzing {textured_path} ({file_size / 1024 / 1024:.1f} MB)...", file=sys.stderr)

    if file_size > _LARGE_FILE_BYTES:
        print(f"Large file — using fast numpy validator (dict-based analysis skipped)", file=sys.stderr)
        metrics = fast_binary_stl_validate(textured_path)
    else:
        analyzer = STLAnalyzer(textured_path)
        metrics = analyzer.compute_metrics(baseline_path)

    # Round floats for readability
    for key in list(metrics.keys()):
        if isinstance(metrics[key], float):
            metrics[key] = round(metrics[key], 2)

    print(json.dumps(metrics, indent=2))


if __name__ == '__main__':
    main()
