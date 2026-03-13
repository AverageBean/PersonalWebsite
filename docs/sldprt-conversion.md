# SLDPRT Conversion Service

The web viewer can now accept `.sldprt` uploads, but conversion is done by a local service using FreeCAD.

## Requirements

- FreeCAD installed (must include `FreeCADCmd`).
- If `FreeCADCmd` is not on your PATH, set `FREECAD_CMD` to its absolute executable path.
- Note: some FreeCAD builds cannot import SolidWorks `.sldprt` files and will return an unsupported format error.

## Fallback Conversion (Another Way)

If local FreeCAD cannot import a given SLDPRT, the converter can fall back to CloudConvert.

- Create a CloudConvert account and API key.
- Set environment variable `CLOUDCONVERT_API_KEY` before starting the converter.

```powershell
$env:CLOUDCONVERT_API_KEY="your-api-key-here"
npm run convert:start
```

When enabled, conversion order is:
1. Local FreeCAD conversion.
2. CloudConvert fallback if local import fails.

## Start the converter

```powershell
npm run convert:start
```

This starts an API at `http://127.0.0.1:8090`.

## Viewer behavior

- Upload `.stl`: loaded directly in browser.
- Upload `.sldprt`: uploaded to local converter, converted to STL, then displayed.

## API

- Health: `GET /api/health`
- Convert: `POST /api/convert/sldprt-to-stl?filename=<name>.sldprt`
  - Request body: raw file bytes (`application/octet-stream`)
  - Response: `model/stl`

## One-Time Onshape Export API

The converter now includes a direct Onshape export endpoint with polling and download.

- Endpoint: `POST /api/convert/onshape/partstudio-to-stl`
- Request body (JSON):

```json
{
  "documentId": "9398b71c9142f1792dbd5283",
  "workspaceId": "a86025d2ec5877ecc7ea8392",
  "elementId": "4c64c574504e72fe50afd862",
  "partId": "JFD",
  "fileName": "CurvedMinimalPost.stl"
}
```

- Required fields: `documentId`, `workspaceId`, `elementId`
- Optional fields: `partId`, `fileName`
- Response: `model/stl`
