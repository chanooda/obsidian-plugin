# daily-calendar ↔ iCloud 양방향 동기화 설계

- 작성일: 2026-06-17
- 대상 플러그인: `plugins/daily-calendar`
- 상태: 설계 승인됨 (구현 계획 작성 전)

## 1. 목표

Obsidian `daily-calendar` 플러그인과 iCloud 캘린더 간 **양방향 동기화**를 구현한다.

- 마크다운(데일리 노트)을 수정하면 iCloud 캘린더에 반영된다.
- iCloud 캘린더를 수정하면 데일리 노트가 갱신된다.
- 일정 추가는 전용 **모달**(제목·설명·시간·캘린더 선택)을 통해 수행하며, 확정 시 마크다운 기록과 iCloud push가 함께 일어난다.

## 2. 핵심 결정 사항

| 항목 | 결정 |
|---|---|
| 데이터 모델 | 마크다운 데일리 노트가 Obsidian 측 표현. iCloud와 **완전 양방향**. 각 일정 줄에 UID를 블록 ID로 매핑 |
| 동기화 범위 | 일정 + 할 일 **모두** iCloud VEVENT로 동기화 (할 일 완료 체크는 iCloud에 반영하지 않음, 필요시 제목에 표시로 우회) |
| 동기화 시점 | **자동 주기**(설정 간격) + **수동 버튼/명령** |
| 충돌 처리 | **LWW**(Last-Write-Wins, 마지막 수정 우선) |
| 캘린더 범위 | 연결된 **여러 캘린더를 읽어** 표시. 새 일정은 모달의 **캘린더 select**에서 고른 캘린더로 push |
| 마크다운 형식 | **블록 ID + 하위 불릿** (사람이 읽기 좋은 형식) |
| 구현 방식 | **최소 자체 CalDAV 구현 + `ical.js`** (Obsidian `requestUrl` 사용) |

## 3. 마크다운 형식

데일리 노트(`YYYY-MM-DD.md`) 내 `## 일정` 섹션에 다음 형식으로 기록한다.

```markdown
## 일정

- 09:00-10:00 치과 예약 [개인] ^ic-a1b2c3
	- 정기 검진, 보험증 지참
- 14:00 팀 회의 [업무] ^ic-d4e5f6
	- 주간 스프린트 리뷰
- 가족 저녁 [가족] ^ic-g7h8i9   (종일)
```

- 시간: `HH:MM` 또는 `HH:MM-HH:MM`. 시간이 없고 `(종일)` 표기면 종일 일정.
- 제목: 시간 뒤 텍스트.
- 캘린더: `[캘린더명]`.
- UID: Obsidian 블록 ID `^ic-xxx`. iCloud UID는 길거나 특수문자를 포함하므로 짧은 로컬 ID(`ic-xxx`)를 부여하고 `event-store`에서 iCloud UID와 매핑한다.
- 설명(description): 들여쓰기 하위 불릿(여러 줄 가능).
- etag, lastSynced 등 동기화 상태 메타는 **마크다운에 두지 않고** `data.json`에 보관한다.

## 4. 아키텍처 & 컴포넌트

```
src/
  main.ts                 // 진입, 명령/리본, 주기 sync 타이머
  settings.ts             // 자격증명, 캘린더 매핑, sync 간격 설정 UI
  calendar-view.ts        // 월간 뷰 (기존) — 이벤트 클릭 시 모달 열기
  ical/
    caldav-client.ts      // requestUrl 기반 CalDAV (탐색/pull/push/delete)
    ics.ts                // ical.js 래퍼: VEVENT <-> 내부 Event 타입
  sync/
    sync-engine.ts        // 양방향 동기화 오케스트레이션 (LWW, sync-token)
    event-store.ts        // uid <-> {blockId, calendar, etag, lastSynced} 매핑 (data.json)
    note-repository.ts    // 데일리 노트 읽기/쓰기 (블록ID + 하위 불릿 파싱/직렬화)
  ui/
    event-modal.ts        // 일정 추가/수정 모달 (제목·설명·시간·캘린더 select)
  types.ts                // Event, CalendarRef 등 공용 타입
```

각 단위의 책임:

- **caldav-client**: 순수 네트워크 계층. iCloud Basic auth(Apple ID + 앱 전용 비밀번호), principal/calendar-home 탐색, calendar 목록 조회, `sync-collection` REPORT로 변경분 pull, PUT/DELETE.
- **ics**: ical.js로 VEVENT ↔ `Event{uid, title, description, start, end, allDay, calendarId}` 변환.
- **note-repository**: 마크다운 ↔ `Event[]` 변환(블록ID 형식). 뷰/모달이 파일을 직접 만지지 않도록 격리.
- **event-store**: 마크다운에 담지 않는 sync 메타(etag, lastSynced, uid↔blockId, sync-token)를 `data.json`에 보관. 충돌·삭제·신규 판정의 기준점.
- **sync-engine**: pull+push 조정, LWW 충돌 해소, 삭제 전파.

## 5. 데이터 흐름

### A. 모달로 일정 추가
1. 캘린더 셀 클릭 → 새 일정 모달(제목/설명/시작·종료 또는 종일/캘린더 select).
2. 확정 시 sync-engine:
   - `caldav-client.put()`으로 iCloud에 VEVENT 생성 → UID·etag 수신.
   - `note-repository`가 해당 날짜 노트에 형식대로 기록(`^ic-xxx` + 하위 불릿).
   - `event-store`에 `{uid, blockId, calendarId, etag, lastSynced}` 저장.
3. 캘린더 뷰 재렌더.

### B. 마크다운 직접 수정 → iCloud push
- vault `modify` 이벤트(디바운스) → 노트 재파싱 → `event-store`와 비교해 변경 블록 검출 → `caldav-client.put()` push, etag 갱신.

### C. iCloud 수정 → 마크다운 갱신 (pull)
- 주기 타이머/수동 명령 → 각 캘린더에 `sync-collection REPORT(sync-token)`로 변경분 수신 → ics 파싱 → `note-repository`가 해당 날짜 노트 블록 갱신/추가, etag·sync-token 저장.

### D. 삭제
- 마크다운에서 줄 삭제 → store에 있던 uid가 노트에 없음 → `caldav-client.delete()`.
- iCloud에서 삭제(pull 시 삭제 표시) → note-repository가 해당 블록 제거.

## 6. 동기화 알고리즘 (LWW)

각 이벤트를 3-way 비교: **로컬(마크다운) / 원격(iCloud) / 마지막 동기화 스냅샷(store)**.

- 로컬만 변경 → push.
- 원격만 변경 → pull(마크다운 갱신).
- 양쪽 다 변경(충돌) → iCloud `LAST-MODIFIED` vs 노트 수정시각 비교 → 최신 승리, 진 쪽 덮어쓰기.
- 한쪽에만 존재 + store에 기록 있음 → 삭제로 간주, 반대편에서도 삭제.
- 한쪽에만 존재 + store에 기록 없음 → 신규로 간주, 반대편에 생성.

## 7. 엣지 케이스 & v1 범위

- **종일 일정**: 지원. 시간 없는 항목 = 종일(VEVENT `DATE`). 형식 `- 제목 [캘린더] ^ic-xxx (종일)`.
- **여러 날 일정(multi-day)**: iCloud→pull 시 걸친 모든 날 노트에 **읽기 전용** 표시(앵커는 시작일 노트). 편집/생성은 시작일 노트 기준.
- **반복 일정(RRULE)**: v1은 iCloud→**읽기 전용** 표시(occurrence 펼침). 모달에서 반복 생성/수정은 **v2로 보류**.
- **타임존**: ical.js가 처리, 로컬 타임존 기준 렌더.

## 8. 보안 & 인증

- Apple ID + **앱 전용 비밀번호**(appleid.apple.com 발급)를 설정에 입력. iCloud는 OAuth 미지원이라 이 방식이 유일.
- ⚠️ 자격증명은 `.obsidian/plugins/daily-calendar/data.json`에 **평문 저장**된다(Obsidian 플러그인 표준 한계). 설정 UI에 경고 표시, vault를 git 등에 올릴 경우 `.gitignore` 안내.
- 데스크톱/모바일 모두 `requestUrl`로 동작 가능. 백그라운드 주기 sync는 데스크톱이 안정적, 모바일은 best-effort.

## 9. 에러 처리

- 네트워크/인증 실패: sync 중단 + Notice/상태바 알림, 다음 주기 재시도. 로컬 데이터 보존(데이터 손실 없음 원칙).
- push 실패: 해당 이벤트를 store에 "미동기화" 표시, 다음 sync 재시도.
- 파싱 실패한 마크다운 줄: 무시(기존 동작 유지).

## 10. 테스트 전략

- `ics.ts`(VEVENT↔Event), `note-repository`(파싱/직렬화), `sync-engine`의 3-way 머지 로직을 **순수 함수**로 분리해 단위 테스트(caldav-client 모킹).
- 네트워크 계층(caldav-client)은 수동 통합 테스트.

## 11. 비목표 (v1 제외)

- 반복 일정의 양방향 생성/수정.
- 할 일 완료 상태의 iCloud 반영.
- iCloud Reminders(VTODO) 연동.
- 자격증명 암호화 저장.
