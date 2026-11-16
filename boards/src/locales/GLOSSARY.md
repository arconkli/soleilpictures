# Translation glossary

Every pass that writes or reviews `src/locales/<locale>/messages.po` follows this file. English
in the code is the source; the catalogs hold Spanish (`es`), French (`fr`), Brazilian Portuguese
(`pt-BR`), Russian (`ru`), Japanese (`ja`) and Korean (`ko`). The public site, help docs, admin
and API/MCP messages stay English and are not extracted.

## Voice, per language

| Locale | Address | Notes |
|---|---|---|
| es | tú | Neutral Spanish for Spain and Latin America: no vosotros, no regional words ("teléfono" rather than "móvil" or "celular", "dispositivo" rather than "ordenador" or "computadora"). |
| fr | vous | France French. A no-break space (U+00A0) before `:` `;` `?` `!` and inside `« »`. |
| pt-BR | você | Brazilian vocabulary (arquivo, tela, celular, baixar). Shown to Portuguese speakers from Portugal too, so avoid slang. |
| ru | вы, lower case | Buttons and menu items in the infinitive (Сохранить, Удалить, Отменить), as Russian interfaces do. Write ё throughout (ещё, всё, её). |
| ja | です/ます | Sentences polite; buttons and menu items short nouns or verb stems (保存, 削除, キャンセル). Full-width 、。 and 「」 quotes; no space between Japanese and numbers. Counters: 人 for people, 件 for items, results and clusters, 枚 for pictures and cards, 日 for days. |
| ko | 해요체 | Sentences in 해요체; buttons and menu items short nouns (저장, 삭제, 취소). Standard Korean spacing. |

## Rules for every language

- Keep every `{placeholder}` and every tag `<0>…</0>`, `<1/>` exactly as written. Their order may
  change to suit the sentence; their names and numbers may not.
- Plurals use the categories CLDR defines for the language (ru: one/few/many/other; ja and ko:
  other only; fr and pt-BR count 0 as one). Never collapse a plural into one form.
- Numbers, dates, prices, sizes and durations always arrive through placeholders formatted for the
  reader's locale. Never type a number into a translation.
- Sentence case, as the English has. Use the single ellipsis character `…`, as the English does.
- Quotes: es and pt-BR “…”; fr and ru « … »; ja 「…」; ko “…”.
- Aim to stay within about a third longer than the English for buttons, tabs and menu items. When
  the natural phrasing runs long, choose the shorter natural one.
- "Clusters" stays as written only as the product name (brand text, the wordmark: those messages
  carry the context `brand`). A heading or list meaning "your clusters" is the ordinary word:
  translate it like cluster (es Clústeres, ru Кластеры, ja クラスター, ko 클러스터).
- Never translate: Soleil, Clusters (the product name), Soleil Clusters, Scout, file extensions, keyboard symbols (⌘,
  ⌥, ⇧, ⌃, Ctrl, Cmd, Esc, Enter, Shift, Tab, Alt, Option), web addresses, @mentions, outside
  products and services (Stripe, Google Drive, Dropbox, Google Takeout, Final Draft, Fountain),
  and names people gave things.
- Plan names: Creator and Team are plan names. Keep them as written, in Latin letters, in every
  language, because they match the receipts and billing pages Stripe shows, which stay English.
  Translate the words around them: es "el plan Creator", fr "l’offre Creator", pt-BR "o plano
  Creator", ru "тариф Creator", ja "Creatorプラン", ko "Creator 요금제". Free, the free plan, is a
  description: translate it (see the table). "Team" meaning the people (the Team page, "your team",
  "team members") is an ordinary word: translate it. The file path and the words around a message
  tell which sense it means.
- Apostrophes: write ’ (U+2019): l’image, d’accord. A straight ' right before a `{placeholder}` or
  a tag hides it, because ICU quoting turns "l'{name}" into the literal text {name}. A `''` in the
  English is one escaped apostrophe: write ’.
- Bold: `**…**` marks words shown in bold. Keep the same number of pairs, around the words that
  carry that meaning.
- Line breaks: a `\n` stays where the English has one.
- Keys: ⌘ ⌥ ⇧ ⌃, Ctrl, Cmd, Esc, Enter, Shift, Tab, Alt and Option stay as written. Space, Delete,
  Backspace and a few others are written the way each language's software labels the key (table
  "Keys" below).
- ⌘K search words (messages with context "command search words"): comma-separated words people
  might type to find a command. Translate them into the everyday words for that action and add two
  or three common synonyms. Keep it to about ten words, comma-separated (ja may use 、). The English
  words stay searchable anyway, so don't repeat them.
- Default names (context "default name"): the names the app gives new things (Untitled, Untitled
  cluster, Color, Group…). Translate each as the name a new thing gets in that language's apps (es
  "Sin título"), and keep it short. They are stored and compared by their translation, so once a
  language ships, never change one.
- Gender: (m.) (f.) (n.) in the table, and (м.) (ж.) (ср.) for Russian, tell you the gender so
  adjectives and participles agree. They are never part of the translation.
- A cell with two words separated by " / " gives two forms the English asks for; the row's first
  column says which is which.

## Product words

The interface says **cluster**; code says board. Translate the interface word.

| English | es | fr | pt-BR | ru | ja | ko |
|---|---|---|---|---|---|---|
| cluster | clúster (pl. clústeres) | cluster (m.) | cluster (m.) | кластер | クラスター | 클러스터 |
| project (a top-level cluster) | proyecto | projet | projeto | проект | プロジェクト | 프로젝트 |
| workspace | espacio de trabajo | espace de travail | espaço de trabalho | рабочее пространство | ワークスペース | 워크스페이스 |
| card | tarjeta | carte | cartão | карточка | カード | 카드 |
| note | nota | note | nota | заметка | メモ | 메모 |
| doc | documento | document | documento | документ | ドキュメント | 문서 |
| section (an outlined group of cards) | sección | section | seção | раздел | セクション | 섹션 |
| canvas | lienzo | toile | tela | холст | キャンバス | 캔버스 |
| picture | imagen | image | imagem | изображение | 画像 | 이미지 |
| file | archivo | fichier | arquivo | файл | ファイル | 파일 |
| link | enlace | lien | link | ссылка | リンク | 링크 |
| palette | paleta | palette | paleta | палитра | パレット | 팔레트 |
| moodboard | moodboard | moodboard | moodboard | мудборд | ムードボード | 무드보드 |
| screenplay | guion | scénario | roteiro | сценарий | 脚本 | 시나리오 |
| tag | etiqueta | étiquette | tag | тег | タグ | 태그 |
| comment | comentario | commentaire | comentário | комментарий | コメント | 댓글 |
| message | mensaje | message | mensagem | сообщение | メッセージ | 메시지 |
| share | compartir | partager | compartilhar | поделиться | 共有 | 공유 |
| invite | invitar | inviter | convidar | пригласить | 招待 | 초대 |
| upload (a file) | subir | importer | enviar | загрузить | アップロード | 업로드 |
| import (many files, a zip, Dropbox, Drive) | importar | importer | importar | импортировать | インポート | 가져오기 |
| download | descargar | télécharger | baixar | скачать | ダウンロード | 다운로드 |
| export | exportar | exporter | exportar | экспортировать | 書き出し | 내보내기 |
| search | buscar | rechercher | pesquisar | поиск | 検索 | 검색 |
| trash | papelera | corbeille | lixeira | корзина | ゴミ箱 | 휴지통 |
| undo | deshacer | annuler | desfazer | отменить | 元に戻す | 실행 취소 |
| settings | configuración | paramètres | configurações | настройки | 設定 | 설정 |
| appearance | apariencia | apparence | aparência | оформление | 外観 | 모양 |
| language | idioma | langue | idioma | язык | 言語 | 언어 |
| automatic | automático | automatique | automático | автоматически | 自動 | 자동 |
| sidebar | barra lateral | barre latérale | barra lateral | боковая панель | サイドバー | 사이드바 |
| toolbar | barra de herramientas | barre d’outils | barra de ferramentas | панель инструментов | ツールバー | 도구 모음 |
| owner | propietario | propriétaire | proprietário | владелец | オーナー | 소유자 |
| co-owner | copropietario | copropriétaire | coproprietário | совладелец | 共同オーナー | 공동 소유자 |
| editor (a seat that can edit) | editor | éditeur | editor | редактор | 編集者 | 편집자 |
| guest | invitado | invité | convidado | гость | ゲスト | 게스트 |
| plan (what someone pays for) | plan | offre | plano | тариф | プラン | 요금제 |
| free trial | prueba gratuita | essai gratuit | teste grátis | пробный период | 無料トライアル | 무료 체험 |
| storage | almacenamiento | stockage | armazenamento | хранилище | ストレージ | 저장 공간 |
| Free (the free plan; also "free" as a price) | gratis | gratuit | grátis | бесплатный (the plan) / бесплатно | 無料 | 무료 |
| Creator (plan name) | Creator | Creator | Creator | Creator | Creator | Creator |
| Team (plan name) | Team | Team | Team | Team | Team | Team |
| team (the people) | equipo (m.) | équipe (f.) | equipe (f.) | команда (ж.) | チーム | 팀 |
| subscription | suscripción (f.) | abonnement (m.) | assinatura (f.) | подписка (ж.) | サブスクリプション | 구독 |
| subscribe (start paying) | suscribirse | s’abonner | assinar | оформить подписку | 申し込む | 구독하기 |
| cancel (a subscription or plan) | cancelar | résilier | cancelar | отменить подписку | 解約 | 해지 |
| renew | renovar | renouveler | renovar | продлевать | 更新 | 갱신 |
| billing | facturación (f.) | facturation (f.) | cobrança (f.) | оплата (ж.) | お支払い | 결제 |
| payment | pago (m.) | paiement (m.) | pagamento (m.) | платёж (м.) | お支払い | 결제 |
| checkout (the step where you pay) | pago (m.) | paiement (m.) | pagamento (m.) | оплата (ж.) | お支払い | 결제 |
| charge (take money) | cobrar | débiter | cobrar | списать | 請求 | 청구 |
| invoice | factura (f.) | facture (f.) | fatura (f.) | счёт (м.) | 請求書 | 청구서 |
| receipt | recibo (m.) | reçu (m.) | recibo (m.) | квитанция (ж.) | 領収書 | 영수증 |
| payment card (not a canvas card) | tarjeta de pago | carte bancaire | cartão | банковская карта | クレジットカード | 결제 카드 |
| upgrade | mejorar | passer à | fazer upgrade | перейти на | アップグレード | 업그레이드 |
| limit | límite (m.) | limite (f.) | limite (m.) | лимит (м.) | 上限 | 한도 |
| card limit | límite de tarjetas | limite de cartes | limite de cartões | лимит карточек | カードの上限 | 카드 한도 |
| unlimited | ilimitado | illimité | ilimitado | без ограничений | 無制限 | 무제한 |
| monthly / yearly (billing period) | mensual / anual | mensuel / annuel | mensal / anual | ежемесячно / ежегодно | 月額 / 年額 | 월간 / 연간 |
| trial (the period) | prueba (f.) | essai (m.) | teste (m.) | пробный период (м.) | トライアル | 체험 |
| seat (one person who can edit) | puesto (m.) | siège (m.) | assento (m.) | место (ср.) | シート | 시트 |
| member | miembro (m.) | membre (m.) | membro (m.) | участник (м.) | メンバー | 멤버 |
| viewer (can look, free) | lector (m.) | lecteur (m.) | leitor (m.) | читатель (м.) | 閲覧者 | 뷰어 |
| person who can edit (the English avoids "editor" here) | persona que edita | personne qui peut modifier | pessoa que pode editar | человек с правом редактирования | 編集できる人 | 편집할 수 있는 사람 |
| admin | administrador (m.) | administrateur (m.) | administrador (m.) | администратор (м.) | 管理者 | 관리자 |
| role | rol (m.) | rôle (m.) | função (f.) | роль (ж.) | 役割 | 역할 |
| access (permission) | acceso (m.) | accès (m.) | acesso (m.) | доступ (м.) | アクセス権 | 액세스 권한 |
| request (ask for access) / request (noun) | solicitar acceso / solicitud (f.) | demander l’accès / demande (f.) | solicitar acesso / solicitação (f.) | запросить доступ / запрос (м.) | アクセスをリクエスト / リクエスト | 액세스 요청 / 요청 |
| approve | aprobar | approuver | aprovar | одобрить | 承認 | 승인 |
| accept (an invite) | aceptar | accepter | aceitar | принять | 承諾 | 수락 |
| transfer ownership | transferir la propiedad | transférer la propriété | transferir a propriedade | передать права владельца | 所有権を譲渡 | 소유권 이전 |
| join | unirse a | rejoindre | juntar-se a | присоединиться | 参加 | 참여 |
| leave (a team or workspace) | salir de | quitter | sair de | покинуть | 退出 | 나가기 |
| person | persona (f.) | personne (f.) | pessoa (f.) | человек (м.) | 人 | 사람 |
| friend | amigo (m.) | ami (m.) | amigo (m.) | друг (м.) | 友だち | 친구 |
| referral | invitación a un amigo (f.) | parrainage (m.) | indicação (f.) | приглашение друга (ср.) | 友だち紹介 | 친구 초대 |
| reward | recompensa (f.) | récompense (f.) | recompensa (f.) | награда (ж.) | 特典 | 보상 |
| invite link | enlace de invitación | lien d’invitation | link de convite | ссылка-приглашение | 招待リンク | 초대 링크 |
| share link | enlace para compartir | lien de partage | link de compartilhamento | ссылка для доступа | 共有リンク | 공유 링크 |
| sharing (the noun: the Sharing panel) | compartir | partage (m.) | compartilhamento (m.) | доступ (м.) | 共有 | 공유 |
| public | público | public | público | публичный | 公開 | 공개 |
| private | privado | privé | privado | приватный | 非公開 | 비공개 |
| revoke (a link or token) | revocar | révoquer | revogar | отозвать | 無効にする | 해제 |
| Explore (the public directory) | Explorar | Explorer | Explorar | Обзор | 探索 | 탐색 |
| waitlist | lista de espera (f.) | liste d’attente (f.) | lista de espera (f.) | список ожидания (м.) | ウェイトリスト | 대기자 명단 |
| demo | demo (f.) | démo (f.) | demo (f.) | демо (ср.) | デモ | 데모 |
| drive (the storage a plan holds; not Google Drive) | unidad (f.) | drive (m.) | drive (m.) | диск (м.) | ドライブ | 드라이브 |
| room (space left under a limit) | espacio (m.) | place (f.) | espaço (m.) | место (ср.) | 空き | 여유 공간 |
| free (storage still available) | libre | disponible | livre | свободно | 空き | 남음 |
| full (a limit is reached) | lleno | plein | cheio | заполнено | いっぱい | 가득 참 |
| folder | carpeta (f.) | dossier (m.) | pasta (f.) | папка (ж.) | フォルダ | 폴더 |
| Files (the sidebar page) | Archivos | Fichiers | Arquivos | Файлы | ファイル | 파일 |
| zip (the file type) | zip | zip | zip | zip | zip | zip |
| photo | foto (f.) | photo (f.) | foto (f.) | фото (ср.) | 写真 | 사진 |
| video | vídeo (m.) | vidéo (f.) | vídeo (m.) | видео (ср.) | 動画 | 동영상 |
| audio | audio (m.) | audio (m.) | áudio (m.) | аудио (ср.) | 音声 | 오디오 |
| Home (the page) | Inicio | Accueil | Início | Главная | ホーム | 홈 |
| sub-cluster (a nested cluster) | subclúster (m.; pl. subclústeres) | sous-cluster (m.) | subcluster (m.) | вложенный кластер (м.) | サブクラスター | 하위 클러스터 |
| page (in a doc) | página (f.) | page (f.) | página (f.) | страница (ж.) | ページ | 페이지 |
| sub-page | subpágina (f.) | sous-page (f.) | subpágina (f.) | вложенная страница (ж.) | サブページ | 하위 페이지 |
| template | plantilla (f.) | modèle (m.) | modelo (m.) | шаблон (м.) | テンプレート | 템플릿 |
| capture (Capture mode) | captura (f.) | capture (f.) | captura (f.) | захват (м.) | キャプチャ | 캡처 |
| version | versión (f.) | version (f.) | versão (f.) | версия (ж.) | バージョン | 버전 |
| version history | historial de versiones | historique des versions | histórico de versões | история версий | バージョン履歴 | 버전 기록 |
| snapshot | instantánea (f.) | instantané (m.) | instantâneo (m.) | снимок (м.) | スナップショット | 스냅샷 |
| archive | archivar | archiver | arquivar | архивировать | アーカイブ | 보관 |
| restore | restaurar | restaurer | restaurar | восстановить | 復元 | 복원 |
| delete | eliminar | supprimer | excluir | удалить | 削除 | 삭제 |
| delete permanently | eliminar definitivamente | supprimer définitivement | excluir permanentemente | удалить навсегда | 完全に削除 | 영구 삭제 |
| remove (take out; the thing still exists) | quitar | retirer | remover | убрать | 外す | 제거 |
| rename | cambiar el nombre | renommer | renomear | переименовать | 名前を変更 | 이름 바꾸기 |
| duplicate | duplicar | dupliquer | duplicar | дублировать | 複製 | 복제 |
| copy (verb) | copiar | copier | copiar | копировать | コピー | 복사 |
| copy (noun: "save a copy") | copia (f.) | copie (f.) | cópia (f.) | копия (ж.) | コピー | 사본 |
| cut (edit action) | cortar | couper | recortar | вырезать | 切り取り | 잘라내기 |
| cut (film edit) | corte (m.) | montage (m.) | corte (m.) | монтаж (м.) | カット | 컷 |
| paste | pegar | coller | colar | вставить | 貼り付け | 붙여넣기 |
| move | mover | déplacer | mover | переместить | 移動 | 이동 |
| select / choose | seleccionar | sélectionner | selecionar | выбрать | 選択 | 선택 |
| attach | adjuntar | joindre | anexar | прикрепить | 添付 | 첨부 |
| drag | arrastrar | faire glisser | arrastar | перетащить | ドラッグ | 드래그 |
| drop (a file onto the canvas) | soltar | déposer | soltar | перетащить сюда | ドロップ | 놓기 |
| filter | filtrar | filtrer | filtrar | фильтр | フィルター | 필터 |
| sort | ordenar | trier | ordenar | сортировать | 並べ替え | 정렬 |
| group (noun: a set of cards) | grupo (m.) | groupe (m.) | grupo (m.) | группа (ж.) | グループ | 그룹 |
| group (verb: "group by") | agrupar | grouper | agrupar | группировать | グループ化 | 그룹화 |
| rail (the tool rail, a vertical bar) | barra de herramientas (f.) | barre d’outils (f.) | barra de ferramentas (f.) | панель инструментов (ж.) | ツールバー | 도구 모음 |
| tool | herramienta (f.) | outil (m.) | ferramenta (f.) | инструмент (м.) | ツール | 도구 |
| pin (fix in place: "pin alongside", "pin to top") | anclar | épingler | fixar | закрепить | 固定 | 고정 |
| pin (a marker at a time or moment) | marca (f.) | repère (m.) | marcador (m.) | отметка (ж.) | ピン | 핀 |
| lock | bloquear | verrouiller | bloquear | заблокировать | ロック | 잠금 |
| hide | ocultar | masquer | ocultar | скрыть | 非表示 | 숨기기 |
| show | mostrar | afficher | mostrar | показать | 表示 | 표시 |
| preview | vista previa (f.) | aperçu (m.) | prévia (f.) | предпросмотр (м.) | プレビュー | 미리보기 |
| Quick look (the feature) | Vista rápida | Coup d’œil | Visualização rápida | Быстрый просмотр | クイックルック | 빠른 보기 |
| thumbnail | miniatura (f.) | miniature (f.) | miniatura (f.) | миниатюра (ж.) | サムネイル | 썸네일 |
| cover (a cluster's cover image) | portada (f.) | couverture (f.) | capa (f.) | обложка (ж.) | カバー | 커버 |
| grid (the Grid card, a layout of cells) | cuadrícula (f.) | grille (f.) | grade (f.) | сетка (ж.) | グリッド | 그리드 |
| cell | celda (f.) | cellule (f.) | célula (f.) | ячейка (ж.) | セル | 셀 |
| column | columna (f.) | colonne (f.) | coluna (f.) | столбец (м.) | 列 | 열 |
| row | fila (f.) | ligne (f.) | linha (f.) | строка (ж.) | 行 | 행 |
| list (a list card or list view) | lista (f.) | liste (f.) | lista (f.) | список (м.) | リスト | 목록 |
| arrow | flecha (f.) | flèche (f.) | seta (f.) | стрелка (ж.) | 矢印 | 화살표 |
| line (a drawn line) | línea (f.) | ligne (f.) | linha (f.) | линия (ж.) | 線 | 선 |
| shape | forma (f.) | forme (f.) | forma (f.) | фигура (ж.) | 図形 | 도형 |
| draw / drawing | dibujar / dibujo (m.) | dessiner / dessin (m.) | desenhar / desenho (m.) | рисовать / рисунок (м.) | 描画 | 그리기 |
| stroke (one pen line) | trazo (m.) | trait (m.) | traço (m.) | штрих (м.) | ストローク | 획 |
| pen | bolígrafo (m.) | stylo (m.) | caneta (f.) | ручка (ж.) | ペン | 펜 |
| eraser (the drawing tool) | borrador (m.) | gomme (f.) | borracha (f.) | ластик (м.) | 消しゴム | 지우개 |
| vote | votar | voter | votar | голосовать | 投票 | 투표 |
| color | color (m.) | couleur (f.) | cor (f.) | цвет (м.) | 色 | 색상 |
| text | texto (m.) | texte (m.) | texto (m.) | текст (м.) | テキスト | 텍스트 |
| font | fuente (f.) | police (f.) | fonte (f.) | шрифт (м.) | フォント | 글꼴 |
| label (a short name on a shape or cell) | rótulo (m.) | libellé (m.) | rótulo (m.) | метка (ж.) | ラベル | 라벨 |
| caption | pie de foto (m.) | légende (f.) | legenda (f.) | подпись (ж.) | キャプション | 캡션 |
| title (the name of a doc or page) | título (m.) | titre (m.) | título (m.) | название (ср.) | タイトル | 제목 |
| title page (of a screenplay) | portada (f.) | page de titre (f.) | página de título (f.) | титульный лист (м.) | 表紙 | 표지 |
| layout | disposición (f.) | mise en page (f.) | layout (m.) | макет (м.) | レイアウト | 레이아웃 |
| view (noun: a way of showing a cluster) | vista (f.) | affichage (m.) | visualização (f.) | вид (м.) | ビュー | 보기 |
| view-only (a permission) | solo lectura | lecture seule | somente leitura | только просмотр | 閲覧のみ | 보기 전용 |
| split view | vista dividida (f.) | vue partagée (f.) | visualização dividida (f.) | разделённый вид (м.) | 分割表示 | 화면 분할 |
| zoom | zoom (m.) | zoom (m.) | zoom (m.) | масштаб (м.) | ズーム | 확대/축소 |
| fit (zoom so everything shows) | ajustar | ajuster | ajustar | вписать | フィット | 맞춤 |
| fit (a limit: "it fits", "didn’t fit") | caber | tenir | caber | поместиться | 収まる | 들어가다 |
| pan (move the view) | desplazar la vista | panoramique (m.) | deslocar a vista | панорамирование (ср.) | パン | 화면 이동 |
| scroll | desplazarse | faire défiler | rolar | прокрутить | スクロール | 스크롤 |
| frame (a film frame; a video moment) | fotograma (m.) | image (f.) | quadro (m.) | кадр (м.) | フレーム | 프레임 |
| frame (a resizable frame on the canvas) | marco (m.) | cadre (m.) | quadro (m.) | фрейм (м.) | フレーム | 프레임 |
| frame rate | velocidad de fotogramas (f.) | cadence d’images (f.) | taxa de quadros (f.) | частота кадров (ж.) | フレームレート | 프레임 속도 |
| track (an audio track) | pista (f.) | piste (f.) | faixa (f.) | дорожка (ж.) | トラック | 트랙 |
| clip | clip (m.) | clip (m.) | clipe (m.) | клип (м.) | クリップ | 클립 |
| timeline | línea de tiempo (f.) | timeline (f.) | linha do tempo (f.) | таймлайн (м.) | タイムライン | 타임라인 |
| timecode | código de tiempo (m.) | timecode (m.) | timecode (m.) | таймкод (м.) | タイムコード | 타임코드 |
| player | reproductor (m.) | lecteur (m.) | reprodutor (m.) | проигрыватель (м.) | プレーヤー | 플레이어 |
| loop | bucle (m.) | boucle (f.) | repetição (f.) | повтор (м.) | ループ | 반복 |
| rewind (roll a cluster or workspace back to an earlier moment; noun: a rewind) | retroceder (n. retroceso) | revenir en arrière (n. retour en arrière) | reverter (n. reversão) | откатить (n. откат) | 巻き戻し | 되돌리기 |
| call sheet | hoja de rodaje (f.) | feuille de service (f.) | ordem do dia (f.) | вызывной лист (м.) | コールシート | 콜시트 |
| schedule (the shoot schedule card) | plan de rodaje (m.) | planning (m.) | cronograma (m.) | расписание (ср.) | スケジュール | 일정 |
| shoot day | día de rodaje (m.) | jour de tournage (m.) | dia de filmagem (m.) | съёмочный день (м.) | 撮影日 | 촬영일 |
| shot (a camera setup) | plano (m.) | plan (m.) | plano (m.) | план (м.) | ショット | 샷 |
| shot list | lista de planos (f.) | liste de plans (f.) | lista de planos (f.) | шот-лист (м.) | ショットリスト | 샷 리스트 |
| storyboard | storyboard (m.) | storyboard (m.) | storyboard (m.) | раскадровка (ж.) | 絵コンテ | 스토리보드 |
| script (same as screenplay) | guion (m.) | scénario (m.) | roteiro (m.) | сценарий (м.) | 脚本 | 시나리오 |
| scene | escena (f.) | scène (f.) | cena (f.) | сцена (ж.) | シーン | 장면 |
| treatment | tratamiento (m.) | traitement (m.) | tratamento (m.) | тритмент (м.) | トリートメント | 트리트먼트 |
| logline | logline (f.) | logline (f.) | logline (f.) | логлайн (м.) | ログライン | 로그라인 |
| draft (a version of writing) | borrador (m.) | brouillon (m.) | rascunho (m.) | черновик (м.) | 下書き | 초안 |
| character (a person in a story) | personaje (m.) | personnage (m.) | personagem (m./f.) | персонаж (м.) | キャラクター | 캐릭터 |
| character (a letter or digit) | carácter (m.) | caractère (m.) | caractere (m.) | символ (м.) | 文字 | 글자 |
| setting (an entity type: a place in a story) | escenario (m.) | décor (m.) | cenário (m.) | место действия (ср.) | 舞台 | 배경 |
| location (a real place to shoot) | lugar de rodaje (m.) | lieu de tournage (m.) | locação (f.) | локация (ж.) | ロケ地 | 촬영지 |
| organization (an entity type) | organización (f.) | organisation (f.) | organização (f.) | организация (ж.) | 組織 | 조직 |
| thing (an entity type) | cosa (f.) | chose (f.) | coisa (f.) | предмет (м.) | もの | 사물 |
| topic (an entity type) | tema (m.) | sujet (m.) | tópico (m.) | тема (ж.) | トピック | 주제 |
| reference (a picture or note you refer to) | referencia (f.) | référence (f.) | referência (f.) | референс (м.) | 参考資料 | 레퍼런스 |
| swatch (a colour sample) | muestra (f.) | échantillon (m.) | amostra (f.) | образец (м.) | スウォッチ | 견본 |
| mention | mencionar | mentionner | mencionar | упомянуть | メンション | 멘션 |
| reply (verb / noun) | responder / respuesta (f.) | répondre / réponse (f.) | responder / resposta (f.) | ответить / ответ (м.) | 返信 | 답글 |
| resolve (a comment thread) | resolver | résoudre | resolver | решить | 解決 | 해결 |
| thread | hilo (m.) | fil (m.) | thread (f.) | ветка (ж.) | スレッド | 스레드 |
| reaction | reacción (f.) | réaction (f.) | reação (f.) | реакция (ж.) | リアクション | 반응 |
| conversation | conversación (f.) | conversation (f.) | conversa (f.) | беседа (ж.) | 会話 | 대화 |
| chat | chat (m.) | chat (m.) | chat (m.) | чат (м.) | チャット | 채팅 |
| unread | no leído | non lu | não lido | непрочитанное | 未読 | 읽지 않음 |
| notification | notificación (f.) | notification (f.) | notificação (f.) | уведомление (ср.) | 通知 | 알림 |
| activity | actividad (f.) | activité (f.) | atividade (f.) | активность (ж.) | アクティビティ | 활동 |
| presence (who is here now) | presencia (f.) | présence (f.) | presença (f.) | присутствие (ср.) | プレゼンス | 접속 상태 |
| live (published and visible) | publicado | en ligne | publicado | опубликовано | 公開中 | 공개 중 |
| live (in real time) | en tiempo real | en temps réel | em tempo real | в реальном времени | リアルタイム | 실시간 |
| sync | sincronizar | synchroniser | sincronizar | синхронизация | 同期 | 동기화 |
| offline | sin conexión | hors ligne | offline | офлайн | オフライン | 오프라인 |
| sign in | iniciar sesión | se connecter | entrar | войти | ログイン | 로그인 |
| sign out | cerrar sesión | se déconnecter | sair | выйти | ログアウト | 로그아웃 |
| sign up | registrarse | s’inscrire | criar conta | зарегистрироваться | 新規登録 | 가입 |
| account | cuenta (f.) | compte (m.) | conta (f.) | аккаунт (м.) | アカウント | 계정 |
| email (the address or the message) | correo electrónico (m.) | e-mail (m.) | e-mail (m.) | эл. почта (ж.) | メール | 이메일 |
| password | contraseña (f.) | mot de passe (m.) | senha (f.) | пароль (м.) | パスワード | 비밀번호 |
| code (a sign-in code) | código (m.) | code (m.) | código (m.) | код (м.) | コード | 코드 |
| passkey | llave de acceso (f.) | clé d’accès (f.) | chave de acesso (f.) | ключ доступа (м.) | パスキー | 패스키 |
| two-step verification | verificación en dos pasos | validation en deux étapes | verificação em duas etapas | двухэтапная аутентификация | 2段階認証 | 2단계 인증 |
| session (a signed-in session) | sesión (f.) | session (f.) | sessão (f.) | сеанс (м.) | セッション | 세션 |
| device | dispositivo (m.) | appareil (m.) | dispositivo (m.) | устройство (ср.) | デバイス | 기기 |
| API key | clave de API (f.) | clé API (f.) | chave de API (f.) | ключ API (м.) | APIキー | API 키 |
| token | token (m.) | jeton (m.) | token (m.) | токен (м.) | トークン | 토큰 |
| connect | conectar | connecter | conectar | подключить | 接続 | 연결 |
| connection (internet, or a linked service) | conexión (f.) | connexion (f.) | conexão (f.) | подключение (ср.) | 接続 | 연결 |
| docs (the help handbook) | documentación (f.) | documentation (f.) | documentação (f.) | документация (ж.) | ドキュメント | 문서 |
| help | ayuda (f.) | aide (f.) | ajuda (f.) | справка (ж.) | ヘルプ | 도움말 |
| shortcut (keyboard) | atajo (m.) | raccourci (m.) | atalho (m.) | сочетание клавиш (ср.) | ショートカット | 단축키 |
| revert (undo one change in the Rewind panel) | revertir | rétablir | reverter | вернуть | 元に戻す | 되돌리기 |
| keep (a draft) | conservar | garder | guardar | сохранить | 保存 | 보관 |
| layer (a drawing layer) | capa (f.) | calque (m.) | camada (f.) | слой (м.) | レイヤー | 레이어 |
| sketch (the drawing panel) | boceto (m.) | croquis (m.) | esboço (m.) | набросок (м.) | スケッチ | 스케치 |
| paint bucket (the fill tool) | bote de pintura (m.) | pot de peinture (m.) | lata de tinta (f.) | заливка (ж.) | 塗りつぶし | 페인트 통 |
| opacity | opacidad (f.) | opacité (f.) | opacidade (f.) | непрозрачность (ж.) | 不透明度 | 불투명도 |
| audit log | registro de auditoría (m.) | journal d’audit (m.) | registro de auditoria (m.) | журнал аудита (м.) | 監査ログ | 감사 로그 |
| build (a release of the app: "Stable build", "Latest build") | versión (f.) | version (f.) | versão (f.) | сборка (ж.) | 安定版 / 最新版 | 빌드 |
| take (a capture) | toma (f.) | prise (f.) | tomada (f.) | дубль (м.) | テイク | 테이크 |
| Picture lock | cierre de montaje (m.) | montage verrouillé (m.) | corte final (m.) | утверждённый монтаж (м.) | ピクチャーロック | 픽처 락 |
| Crew call | hora de citación (f.) | convocation de l’équipe (f.) | chamada da equipe (f.) | сбор группы (м.) | クルー集合 | 스태프 콜 |
| Push in (a camera move) | acercar | zoom avant (m.) | aproximar | приблизить | プッシュイン | 푸시 인 |
| cast (the people in a production) | reparto (m.) | distribution (f.) | elenco (m.) | состав (м.) | キャスト | 출연진 |
| Grain (film grain) | grano (m.) | grain (m.) | granulação (f.) | зерно (ср.) | グレイン | 그레인 |
| key (music) | tonalidad (f.) | tonalité (f.) | tom (m.) | тональность (ж.) | キー | 키 |
| Guides (framing guides over the picture) | guías (f. pl.) | repères (m. pl.) | guias (f. pl.) | направляющие (мн.) | ガイド | 가이드 |
| Scope (the 2.39:1 aspect ratio) | Scope | Scope | Scope | скоуп | シネスコ | 스코프 |
| tile (a square or block in a tile layout) | mosaico (m.) | vignette (f.) | bloco (m.) | плитка (ж.) | タイル | 타일 |
| merge (tags) | combinar | fusionner | mesclar | объединить | 統合 | 병합 |
| starred / Starred | con estrella | favori | com estrela | помеченные | スター付き | 별표 |
| Shared with you (the sidebar section; once "Shared with me") | compartido contigo | partagé avec vous | compartilhado com você | доступно вам | 共有アイテム | 나와 공유됨 |
| Shared (the Shared page: what is shared with you and by you) | compartido | partagé | compartilhado | общий доступ | 共有済み | 공유됨 |
| hash | hash (m.) | hachage (m.) | hash (m.) | хеш (м.) | ハッシュ | 해시 |
| endpoint | endpoint (m.) | point de terminaison (m.) | endpoint (m.) | эндпоинт (м.) | エンドポイント | 엔드포인트 |
| Manage billing | gestionar facturación | gérer la facturation | gerenciar cobrança | управление оплатой | お支払いを管理 | 결제 관리 |
| Emerging (tags) | emergentes | émergentes | emergentes | возникающие | 新たに登場 | 새로 나타남 |
| box (a Grid cell) | recuadro (m.) | case (f.) | caixa (f.) | ячейка (ж.) | セル | 칸 |
| Tidy up | ordenar | ranger | arrumar | упорядочить | 整理 | 정리 |
| AI chat | chat de IA (m.) | chat IA (m.) | chat de IA (m.) | ИИ-чат (м.) | AIチャット | AI 채팅 |
| In/Out points (a clip's start and end marks) | puntos de entrada/salida | points d’entrée/sortie | pontos de entrada/saída | точки входа/выхода | イン点/アウト点 | 인/아웃 포인트 |
| clean mode | modo limpio (m.) | mode épuré (m.) | modo limpo (m.) | чистый режим (м.) | クリーンモード | 클린 모드 |

## Interface words

General words and phrases the app repeats. Same columns and the same rules as above.

| English | es | fr | pt-BR | ru | ja | ko |
|---|---|---|---|---|---|---|
| add | añadir | ajouter | adicionar | добавить | 追加 | 추가 |
| create | crear | créer | criar | создать | 作成 | 만들기 |
| new | nuevo | nouveau | novo | новый | 新規 | 새 |
| edit | editar | modifier | editar | изменить | 編集 | 편집 |
| change | cambiar | changer | alterar | поменять | 変更 | 변경 |
| changes (what someone edited) | cambios | modifications | alterações | изменения | 変更 | 변경 사항 |
| save | guardar | enregistrer | salvar | сохранить | 保存 | 저장 |
| apply | aplicar | appliquer | aplicar | применить | 適用 | 적용 |
| confirm | confirmar | confirmer | confirmar | подтвердить | 確認 | 확인 |
| done | listo | terminé | concluído | готово | 完了 | 완료 |
| continue | continuar | continuer | continuar | продолжить | 続行 | 계속 |
| skip | omitir | passer | pular | пропустить | スキップ | 건너뛰기 |
| next / previous | siguiente / anterior | suivant / précédent | próximo / anterior | далее / предыдущий | 次へ / 前へ | 다음 / 이전 |
| cancel (a dialog or action) | cancelar | annuler | cancelar | отмена | キャンセル | 취소 |
| open (verb) | abrir | ouvrir | abrir | открыть | 開く | 열기 |
| open (a state: "keep this tab open") | abierto | ouvert | aberto | открытым | 開いたまま | 열어 둠 |
| close (a panel, a dialog) | cerrar | fermer | fechar | закрыть | 閉じる | 닫기 |
| back (go to the previous screen) | atrás | retour | voltar | назад | 戻る | 뒤로 |
| clear (empty a box, a filter, a selection) | borrar | effacer | limpar | очистить | クリア | 지우기 |
| clear (free up space) | liberar espacio | libérer de la place | liberar espaço | освободить место | 空き容量を増やす | 공간 확보 |
| try again (sentence / button) | vuelve a intentarlo / reintentar | réessayez / réessayer | tente novamente / tentar novamente | повторите попытку / повторить | もう一度お試しください / 再試行 | 다시 시도해 주세요 / 다시 시도 |
| couldn’t (an action failed) | no se pudo | impossible de | não foi possível | не удалось | できませんでした | 할 수 없어요 |
| nothing yet (empty states) | aún no hay nada | rien pour l’instant | ainda não há nada | пока ничего нет | まだありません | 아직 아무것도 없어요 |
| yet | aún | pas encore | ainda | ещё | まだ | 아직 |
| check your connection | comprueba tu conexión | vérifiez votre connexion | verifique sua conexão | проверьте подключение | 接続を確認してください | 연결을 확인해 주세요 |
| load / loading | cargar / cargando | charger / chargement | carregar / carregando | загрузить / загрузка | 読み込み / 読み込み中 | 불러오기 / 불러오는 중 |
| reload | recargar | recharger | recarregar | перезагрузить | 再読み込み | 새로고침 |
| error | error (m.) | erreur (f.) | erro (m.) | ошибка (ж.) | エラー | 오류 |
| name | nombre (m.) | nom (m.) | nome (m.) | название (ср.) | 名前 | 이름 |
| date | fecha (f.) | date (f.) | data (f.) | дата (ж.) | 日付 | 날짜 |
| day | día (m.) | jour (m.) | dia (m.) | день (м.) | 日 | 일 |
| info / details | información (f.) | infos (f.) | informações (f.) | сведения (ср.) | 情報 | 정보 |
| actions | acciones | actions | ações | действия | アクション | 작업 |
| default | predeterminado | par défaut | padrão | по умолчанию | デフォルト | 기본 |
| custom | personalizado | personnalisé | personalizado | свой | カスタム | 사용자 지정 |
| optional | opcional | facultatif | opcional | необязательно | 任意 | 선택 사항 |
| app | app (f.) | application (f.) | app (m.) | приложение (ср.) | アプリ | 앱 |
| browser | navegador (m.) | navigateur (m.) | navegador (m.) | браузер (м.) | ブラウザ | 브라우저 |
| computer | dispositivo (m.) | ordinateur (m.) | computador (m.) | компьютер (м.) | パソコン | 컴퓨터 |
| phone | teléfono (m.) | téléphone (m.) | celular (m.) | телефон (м.) | スマートフォン | 휴대전화 |
| screen | pantalla (f.) | écran (m.) | tela (f.) | экран (м.) | 画面 | 화면 |
| full screen | pantalla completa | plein écran | tela cheia | полноэкранный режим | 全画面表示 | 전체 화면 |
| tab (a browser tab or a panel tab) | pestaña (f.) | onglet (m.) | guia (f.) | вкладка (ж.) | タブ | 탭 |
| menu | menú (m.) | menu (m.) | menu (m.) | меню (ср.) | メニュー | 메뉴 |
| click | hacer clic | cliquer | clicar | нажать | クリック | 클릭 |
| double-click | doble clic | double-clic | clique duplo | двойной щелчок | ダブルクリック | 더블클릭 |
| right-click | clic derecho | clic droit | clique com o botão direito | щелчок правой кнопкой | 右クリック | 우클릭 |
| tap (on a touch screen) | tocar | appuyer | tocar | коснуться | タップ | 탭 |
| press (a key) | pulsar | appuyer sur | pressionar | нажать | 押す | 누르기 |
| hold (a key) | mantener pulsado | maintenir | manter pressionado | удерживать | 押し続ける | 누르고 있기 |
| send | enviar | envoyer | enviar | отправить | 送信 | 보내기 |
| chrome (the interface around the canvas) | interfaz (f.) | interface (f.) | interface (f.) | интерфейс (м.) | UI | UI |
| toast (a short notice) | aviso (m.) | notification (f.) | aviso (m.) | уведомление (ср.) | トースト | 알림 |
| Sheet (the panel that slides up on a phone) | hoja (f.) | feuille (f.) | painel (m.) | панель (ж.) | シート | 패널 |
| Dismiss (a suggestion) | descartar | ignorer | dispensar | скрыть | 却下 | 무시 |
| Dismiss (a notice or banner) | descartar | ignorer | dispensar | закрыть | 閉じる | 닫기 |

## Keys

Labels as each language's software prints them on screen. Ctrl, Cmd, Esc, Enter, Shift, Tab, Alt and
Option are in the first rule above and never change.

| Key | es | fr | pt-BR | ru | ja | ko |
|---|---|---|---|---|---|---|
| Space | Espacio | Espace | Espaço | Пробел | スペース | 스페이스 |
| Delete (Del) | Supr | Suppr | Delete | Delete | Delete | Delete |
| Backspace | Retroceso | Retour arrière | Backspace | Backspace | Backspace | Backspace |
| Home / End | Inicio / Fin | Début / Fin | Home / End | Home / End | Home / End | Home / End |
| Menu | Menú | Menu | Menu | Menu | Menu | Menu |

## Screenplay elements

Messages with context "screenplay element". They name the kinds of line in a screenplay, as
screenplay software in each language names them.

| English | es | fr | pt-BR | ru | ja | ko |
|---|---|---|---|---|---|---|
| Scene Heading | Encabezado de escena | Intitulé de scène | Cabeçalho de cena | Заголовок сцены | 柱 | 장면 제목 |
| Action | Acción | Action | Ação | Действие | ト書き | 지문 |
| Character | Personaje | Personnage | Personagem | Персонаж | 人物名 | 등장인물 |
| Dialogue | Diálogo | Dialogue | Diálogo | Диалог | セリフ | 대사 |
| Parenthetical | Acotación | Didascalie | Rubrica | Ремарка | カッコ書き | 괄호 지문 |
| Transition | Transición | Transition | Transição | Переход | 場面転換 | 장면 전환 |
| Shot | Plano | Plan | Plano | План | ショット | 샷 |
| Centered | Centrado | Centré | Centralizado | По центру | 中央揃え | 가운데 |

## Default names

Context "default name". The first words of each name follow the table above.

| English | es | fr | pt-BR | ru | ja | ko |
|---|---|---|---|---|---|---|
| Untitled | Sin título | Sans titre | Sem título | Без названия | 無題 | 제목 없음 |
| Untitled cluster | Clúster sin título | Cluster sans titre | Cluster sem título | Кластер без названия | 無題のクラスター | 제목 없는 클러스터 |
| Untitled doc | Documento sin título | Document sans titre | Documento sem título | Документ без названия | 無題のドキュメント | 제목 없는 문서 |
| Untitled script | Guion sin título | Scénario sans titre | Roteiro sem título | Сценарий без названия | 無題の脚本 | 제목 없는 시나리오 |
| Color | Color | Couleur | Cor | Цвет | カラー | 색상 |
| Group | Grupo | Groupe | Grupo | Группа | グループ | 그룹 |

Add a word here the first time a translation pass has to choose one, so every later pass agrees.
