# Rocketbox Interviewer Avatar

Default model: `rocketbox-interviewer.glb`

Source asset: Microsoft Rocketbox `Assets/Avatars/Professions/Business_Male_02/Export/Business_Male_02_facial.fbx`.

Source repository: https://github.com/microsoft/Microsoft-Rocketbox

License: Microsoft Rocketbox is published under the MIT License. A local copy is included in `Microsoft-Rocketbox-LICENSE.md`.

Conversion notes:
- Downloaded the `Business_Male_02_facial.fbx` file and its `m008_*` textures.
- Converted TGA textures to 1024px PNG before FBX conversion because the original FBX stores Windows texture paths.
- Converted FBX to GLB with FBX2glTF.
- Compressed textures to WebP with glTF Transform, preserving the original scene scale and avoiding mesh quantization.
- The visual foreground uses a cropped Rocketbox preview render from the same character because browser-side FBX conversion renders the eye/hair cards incorrectly without a Blender retargeting pass.

`rocketbox-interviewer-poster.png` is a cropped transparent poster from the same Rocketbox character preview and is used for compact persona cards to avoid spawning multiple WebGL renderers.
