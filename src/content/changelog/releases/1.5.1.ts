import type { ChangelogRelease } from "../types";

const release: ChangelogRelease = {
  version: "1.5.1",
  date: "2026-06-25",
  title: {
    en: "Scope your search: @online, @local, @video, @audio",
    zh: "搜索作用域：@在线、@本地、@视频、@音频",
    ja: "検索を絞り込む：@online・@local・@video・@audio",
    ko: "검색 범위 지정: @online·@local·@video·@audio",
  },
  summary: {
    en: "Global search (⌘/Ctrl+F) gains four quick filters. Type @ and pick: @online searches only your enabled streaming sources, @local searches only your device library, and @video / @audio narrow your local library to just videos or just audio. Local-scoped filters skip the network entirely, so searching your own library never waits on online sources.",
    zh: "全局搜索（⌘/Ctrl+F）新增四个快捷过滤。输入 @ 选择：@在线 只搜你已启用的在线来源，@本地 只搜设备本地库，@视频 / @音频 把本地库收窄到只看视频或只听音频。本地作用域的过滤完全不走网络，搜自己的库不再等在线来源。",
    ja: "グローバル検索（⌘/Ctrl+F）に 4 つのクイックフィルターが加わりました。@ を入力して選択：@online は有効なオンラインソースのみ、@local はデバイス内ライブラリのみ、@video / @audio はローカルライブラリを動画だけ・音声だけに絞り込みます。ローカル指定のフィルターはネットワークを使わないので、自分のライブラリ検索が待たされません。",
    ko: "전역 검색(⌘/Ctrl+F)에 네 가지 빠른 필터가 추가되었습니다. @ 를 입력해 선택하세요: @online 은 활성화된 온라인 소스만, @local 은 기기 라이브러리만 검색하고, @video / @audio 는 로컬 라이브러리를 영상만 또는 오디오만으로 좁힙니다. 로컬 범위 필터는 네트워크를 사용하지 않아 내 라이브러리 검색이 기다리지 않습니다.",
  },
  items: [
    {
      area: "search",
      category: "highlight",
      platform: "all",
      title: {
        en: "Four new @ filters in global search",
        zh: "全局搜索的四个 @ 过滤",
        ja: "グローバル検索に 4 つの @ フィルター",
        ko: "전역 검색의 네 가지 @ 필터",
      },
      description: {
        en: "In the ⌘/Ctrl+F search box, type @ to scope your search. @online looks only at your enabled online sources; @local stays on your device library; @video and @audio show only videos or only audio from your library. @local / @video / @audio never touch the network, so local searches stay instant. (CJK aliases work too — e.g. @视频 / @在线.)",
        zh: "在 ⌘/Ctrl+F 搜索框里输入 @ 即可限定范围。@在线 只看已启用的在线来源；@本地 只看设备本地库；@视频、@音频 只显示库里的视频或音频。@本地 / @视频 / @音频 不触发任何网络请求，本地搜索始终即时。（中英别名都支持，例如 @视频 / @video。）",
        ja: "⌘/Ctrl+F の検索ボックスで @ を入力すると範囲を指定できます。@online は有効なオンラインソースのみ、@local はデバイス内ライブラリのみ、@video・@audio はライブラリの動画／音声だけを表示します。@local・@video・@audio はネットワークを使わず、ローカル検索は常に即時です。（中国語の別名も使えます。例：@视频 / @在线。）",
        ko: "⌘/Ctrl+F 검색창에서 @ 를 입력하면 범위를 지정할 수 있습니다. @online 은 활성화된 온라인 소스만, @local 은 기기 라이브러리만, @video·@audio 는 라이브러리의 영상 또는 오디오만 표시합니다. @local·@video·@audio 는 네트워크를 사용하지 않아 로컬 검색이 항상 즉시 실행됩니다. (중국어 별칭도 지원: 예 @视频 / @在线.)",
      },
    },
  ],
};

export default release;
