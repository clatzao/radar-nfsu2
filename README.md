# Radar NFSU2

Mapa de navegação para central multimídia Android (e celular) com o visual do radar do **Need for Speed: Underground 2**.

- Mapa em tela cheia no estilo do radar do jogo (OpenStreetMap + MapLibre)
- Velocímetro no estilo do HUD do jogo (pode ser desligado e redimensionado)
- Nome da rua, temperatura e horário
- Busca de endereços, rotas com instruções faladas em português e horário de chegada
- Estabelecimentos no mapa e locais salvos com a "bola colorida" das lojas do jogo

## Estrutura

| Pasta | O que é |
|---|---|
| `nfsu2-radar/web` | A interface (HTML/CSS/JS). É a mesma no navegador e no app. |
| `nfsu2-radar/serve.js` | Servidor local para testar no PC: `node nfsu2-radar/serve.js` → http://localhost:8080 |
| `nfsu2-app` | App Android (WebView + GPS e voz nativos). A cada build copia `nfsu2-radar/web` para os assets. |

No PC não há GPS: use **Ajustes → Simular trajeto** (ou abra `http://localhost:8080/?demo`).

## Gerar o APK

Requer Android Studio (usa o JDK que vem com ele):

```bash
cd nfsu2-app
JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug
```

O APK sai em `nfsu2-app/app/build/outputs/apk/debug/app-debug.apk`.

## Baixar e atualizar

- Baixe o APK mais recente em [Releases](https://github.com/clatzao/radar-nfsu2/releases/latest).
- A partir da v0.3 o app procura versões novas sozinho ao abrir (**Ajustes → Aplicativo**) e instala com um toque.

## Publicar uma nova versão

```powershell
powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 0.4 -Notes "O que mudou"
```

O script aumenta a versão, gera o APK, faz commit + tag, envia e cria a Release. Os APKs são assinados com a chave de
debug deste PC (`%USERPROFILE%\.android\debug.keystore`): **guarde uma cópia dela**, porque só APKs com a mesma chave
conseguem atualizar o app já instalado.

## Serviços usados (gratuitos)

Mapa: OpenFreeMap / OpenStreetMap · Busca e endereços: Photon (komoot) · Rotas: Valhalla (FOSSGIS) e OSRM · Temperatura: Open-Meteo.

Projeto pessoal de fã, sem relação com a Electronic Arts. Fonte Exo 2 sob SIL Open Font License; MapLibre GL JS sob licença BSD.
