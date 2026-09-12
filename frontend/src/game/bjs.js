// game/bjs.js — 把 ESM 的 Babylon 挂为全局，供旧代码 window.BABYLON 使用，同时提供命名导出
import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color.js";
import { Vector3, Quaternion, Matrix } from "@babylonjs/core/Maths/math.vector.js";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";

const BABYLON = {
  Engine,
  Scene,
  Mesh,
  VertexData,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  Quaternion,
  Matrix,
  DynamicTexture,
  Texture,
  UniversalCamera,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  ShadowGenerator,
};

if (typeof window !== "undefined") {
  window.BABYLON = window.BABYLON || {};
  Object.assign(window.BABYLON, BABYLON);
  // 兼容旧代码直接用 BABYLON.MeshBuilder 等
  window.BABYLON.MeshBuilder = MeshBuilder;
  window.BABYLON.StandardMaterial = StandardMaterial;
  window.BABYLON.Color3 = Color3;
  window.BABYLON.Color4 = Color4;
  window.BABYLON.Vector3 = Vector3;
  window.BABYLON.DynamicTexture = DynamicTexture;
}

export { BABYLON };
export default BABYLON;
