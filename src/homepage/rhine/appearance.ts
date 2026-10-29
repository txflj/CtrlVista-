import * as THREE from "three";
import { themeMaterial } from "./theme-material";
type Surface = THREE.MeshPhysicalMaterial;
type Palette = { high: Surface; low?: Surface };
/** One shared opaque cartridge geometry in the array and during extraction. */
export class CardAppearance {
  private palettes = new Map<string, Palette>();
  disposeSources() {
    for (const palette of this.palettes.values()) { palette.high.dispose(); palette.low?.dispose(); }
    this.palettes.clear();
  }
  register(name: string, high: Surface, low?: Surface) { this.palettes.set(name, { high, low }); }
  prepare(group: THREE.Group) {
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const name = mesh.userData.surface as string;
      const palette = this.palettes.get(name);
      if (!palette) {
        if (mesh.userData.signalScreen) delete mesh.userData.themeAmount;
        else mesh.userData.themeAmount = themeMaterial(mesh.material as THREE.Material, "Printed_Canvas");
        continue;
      }
      mesh.material = palette.high.clone();
      mesh.userData.appearance = { value: 0 };
      mesh.userData.glassClarity = { value: 0 };
      mesh.userData.subduedIndex = { value: 0 };
      mesh.userData.themeAmount = themeMaterial(mesh.material, name, false, mesh.userData.subduedIndex);
    }
  }
  setClarity(group: THREE.Group, value: number) {
    // Document and display share the old reveal time; there is no frosted cover now.
    group.traverse(child => { if (child.userData.glassClarity) child.userData.glassClarity.value = THREE.MathUtils.clamp(value, 0, 1); });
  }
  setTheme(group: THREE.Group, value: number, subduedIndex: boolean | number = false) {
    group.traverse(child => {
      if (child.userData.themeAmount) child.userData.themeAmount.value = value;
      if (child.userData.subduedIndex) child.userData.subduedIndex.value = THREE.MathUtils.clamp(Number(subduedIndex), 0, 1);
    });
  }
  apply(group: THREE.Group, value: number) {
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const palette = this.palettes.get(mesh.userData.surface);
      if (!palette) {
        (mesh.material as THREE.MeshBasicMaterial).opacity = mesh.userData.signalScreen ? 1 : value;
        continue;
      }
      mesh.userData.appearance.value = value;
      if (!palette.low) continue;
      const mat = mesh.material as Surface;
      mat.color.copy(palette.low.color).lerp(palette.high.color, value);
      for (const key of ["roughness", "metalness", "clearcoat", "clearcoatRoughness"] as const)
        mat[key] = THREE.MathUtils.lerp(palette.low[key], palette.high[key], value);
    }
  }
  dispose(group: THREE.Group) {
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (!mesh.userData.surface) mat.map?.dispose();
      mat.dispose();
    }
  }
}
