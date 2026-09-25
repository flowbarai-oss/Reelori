import { useState } from "react";
import { Plus, MapPin, Users, PencilSimple } from "@phosphor-icons/react";
import type { Project } from "../../../packages/contracts/index.ts";

export function ProductionPanel({ project, lang, busy, save }: {
  project: Project;
  lang: string;
  busy: boolean;
  save: (path: string, body: object) => Promise<boolean>;
}) {
  const t = (zh: string, en: string) => lang === "zh" ? zh : en;
  const displayScene = (name: string) => lang === "zh" ? name : name.replace(/^场景 (\d+)$/, "Scene $1");
  const [sceneId, setSceneId] = useState("");
  const [sceneName, setSceneName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [description, setDescription] = useState("");
  const [referenceId, setReferenceId] = useState("");
  function clearScene() { setSceneId(""); setSceneName(""); setLocation(""); setNotes(""); }
  function clearCharacter() { setCharacterId(""); setCharacterName(""); setDescription(""); setReferenceId(""); }
  return <details className="panel production-panel">
    <summary>
      <strong>{t("分场与角色", "Scenes & cast")}</strong>
      <span>{project.scenes?.length ?? 0} {t("场", (project.scenes?.length ?? 0) === 1 ? "scene" : "scenes")} · {project.characters?.length ?? 0} {t("人", (project.characters?.length ?? 0) === 1 ? "character" : "characters")}</span>
    </summary>
    <div className="production-columns">
      <section>
        <h3><MapPin size={17} /> {t("场景", "Scenes")}</h3>
        <div className="production-items">
          {(project.scenes ?? []).map((scene) => <button type="button" key={scene.id} onClick={() => {
            setSceneId(scene.id); setSceneName(scene.name); setLocation(scene.location); setNotes(scene.notes);
          }}><span>{displayScene(scene.name)}</span><PencilSimple size={15} /></button>)}
        </div>
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (await save("scene", { revision: project.revision, scene: {
            ...(sceneId ? { id: sceneId } : {}), name: sceneName, location, notes,
          } })) clearScene();
        }}>
          <label>{t("场景名称", "Scene name")}
            <input required maxLength={80} value={sceneName} onChange={(event) => setSceneName(event.target.value)} />
          </label>
          <label>{t("地点 / 时间", "Place / time")}
            <input maxLength={120} value={location} onChange={(event) => setLocation(event.target.value)} />
          </label>
          <label>{t("连续性备注", "Continuity notes")}
            <textarea maxLength={500} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <div className="production-actions">
            <button className="secondary" type="button" onClick={clearScene}>{t("新场景", "New scene")}</button>
            <button className="primary" disabled={busy || !sceneName.trim()}><Plus size={15} />{t("保存", "Save")}</button>
          </div>
        </form>
      </section>
      <section>
        <h3><Users size={17} /> {t("角色", "Cast")}</h3>
        <div className="production-items">
          {(project.characters ?? []).map((character) => <button type="button" key={character.id} onClick={() => {
            setCharacterId(character.id); setCharacterName(character.name);
            setDescription(character.description); setReferenceId(character.referenceId ?? "");
          }}><span>{character.name}</span><PencilSimple size={15} /></button>)}
        </div>
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (await save("character", { revision: project.revision, character: {
            ...(characterId ? { id: characterId } : {}), name: characterName,
            description, referenceId,
          } })) clearCharacter();
        }}>
          <label>{t("角色姓名", "Character name")}
            <input required maxLength={80} value={characterName} onChange={(event) => setCharacterName(event.target.value)} />
          </label>
          <label>{t("外观与性格", "Appearance & character")}
            <textarea maxLength={500} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label>{t("已确认参考图", "Confirmed reference")}
            <select value={referenceId} onChange={(event) => setReferenceId(event.target.value)}>
              <option value="">{t("暂不关联", "None yet")}</option>
              {(project.references ?? []).map((reference) =>
                <option key={reference.id} value={reference.id}>{reference.name}</option>)}
            </select>
          </label>
          <div className="production-actions">
            <button className="secondary" type="button" onClick={clearCharacter}>{t("新角色", "New character")}</button>
            <button className="primary" disabled={busy || !characterName.trim()}><Plus size={15} />{t("保存", "Save")}</button>
          </div>
        </form>
      </section>
    </div>
    <p className="fine">{t("在镜头编辑中指定场景和出场角色。参考图目前仅供人工对照，尚不会发送给生成模型。", "Assign scenes and cast in each shot. Reference images still support human review only; they are not yet sent to the model.")}</p>
  </details>;
}
