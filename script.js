document.addEventListener('DOMContentLoaded', () => {
    const { createApp, ref, computed, onMounted, onUnmounted, watch, nextTick, provide, inject } = Vue;

    // --- SHARED HELPERS ---

    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    const MD_NUL = String.fromCharCode(0);

    // Curated shortcode → emoji map for the ":code:" syntax in notes. Kept compact
    // (common productivity/status/object set) rather than the full Unicode list.
    // Aliases point at the same glyph (e.g. thumbsup / +1). Unknown codes are left
    // as-is, so a stray ":foo:" is harmless plain text.
    const EMOJI_MAP = {
        white_check_mark: '✅', check: '✔️', heavy_check_mark: '✔️', x: '❌', cross: '❌',
        warning: '⚠️', no_entry: '⛔', question: '❓', exclamation: '❗', bangbang: '‼️',
        fire: '🔥', star: '⭐', sparkles: '✨', boom: '💥', zap: '⚡', bell: '🔔',
        hourglass: '⏳', clock: '🕐', alarm_clock: '⏰', calendar: '📅', date: '📆',
        arrow_up: '⬆️', arrow_down: '⬇️', arrow_right: '➡️', arrow_left: '⬅️',
        up: '🔼', top: '🔝', new: '🆕', soon: '🔜',
        thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', clap: '👏', wave: '👋',
        pray: '🙏', muscle: '💪', point_right: '👉', ok_hand: '👌', raised_hands: '🙌',
        eyes: '👀', brain: '🧠',
        smile: '😄', grin: '😁', joy: '😂', wink: '😉', blush: '😊', thinking: '🤔',
        neutral_face: '😐', confused: '😕', cry: '😢', sob: '😭', angry: '😠', rage: '😡',
        sunglasses: '😎', sweat_smile: '😅', partying: '🥳', exploding_head: '🤯',
        rocket: '🚀', tada: '🎉', party: '🎉', bulb: '💡', idea: '💡', memo: '📝',
        pencil: '✏️', pushpin: '📌', paperclip: '📎', link: '🔗', bookmark: '🔖',
        book: '📖', books: '📚', clipboard: '📋', file: '📄', folder: '📁',
        chart: '📊', chart_up: '📈', chart_down: '📉', moneybag: '💰', dollar: '💵',
        email: '📧', mailbox: '📬', phone: '📱', computer: '💻', keyboard: '⌨️',
        bug: '🐛', wrench: '🔧', hammer: '🔨', gear: '⚙️', lock: '🔒', unlock: '🔓',
        key: '🔑', flag: '🚩', target: '🎯', dart: '🎯', trophy: '🏆', medal: '🏅',
        gift: '🎁', package: '📦', label: '🏷️',
        coffee: '☕', tea: '🍵', beer: '🍺', pizza: '🍕', cake: '🎂', hamburger: '🍔',
        heart: '❤️', orange_heart: '🧡', yellow_heart: '💛', green_heart: '💚',
        blue_heart: '💙', purple_heart: '💜', broken_heart: '💔', hundred: '💯',
        checkered_flag: '🏁', sos: '🆘', recycle: '♻️',
        sun: '☀️', cloud: '☁️', rainbow: '🌈', snowflake: '❄️', droplet: '💧',
        seedling: '🌱', tree: '🌳', earth: '🌍', house: '🏠', office: '🏢',
        car: '🚗', airplane: '✈️', train: '🚆', bike: '🚲', run: '🏃',
        dog: '🐶', cat: '🐱', unicorn: '🦄', turtle: '🐢', bee: '🐝',
        ghost: '👻', robot: '🤖', alien: '👽', skull: '💀', poop: '💩',
        pill: '💊', battery: '🔋',
    };

    // Inline markdown shared by titles, subtasks, and notes: links, bold, italic,
    // and @handles. Operates on already-escaped text with code spans/blocks
    // already swapped out for placeholders, so it never reaches inside them.
    // opts.emoji enables ":code:" → emoji substitution (notes only).
    function applyInline(t, opts) {
        opts = opts || {};
        // Markdown-style [label](url) lets you shorten a link's visible text.
        t = t.replace(/\[([^\[\]]+)\]\((https?:\/\/[^\s()]+)\)/g,
            (m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
        // Auto-link bare URLs, skipping any already inside a tag/attribute.
        t = t.replace(/(?![^<]*>|[^<>]*<\/a>)\b(https?:\/\/[^\s<]+)/g,
            (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
        // Bold before italic, so "**" isn't mistaken for a pair of italic markers.
        t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
        // @handles: an @ at a word boundary (so email local-parts like name@host
        // don't match) and not inside a tag we just emitted.
        t = t.replace(/(^|[\s(])@([a-zA-Z0-9][a-zA-Z0-9._-]*)(?![^<]*>)/g,
            (m, pre, name) => `${pre}<span class="handle">@${name}</span>`);
        // :shortcode: → emoji. Runs last, and the (?![^<]*>) guard keeps it out of
        // any tag/attribute we just emitted (e.g. a URL that contains a colon).
        // Unknown codes are returned unchanged.
        if (opts.emoji) {
            t = t.replace(/:([a-z0-9_+-]+):(?![^<]*>)/gi,
                (m, code) => EMOJI_MAP[code.toLowerCase()] || m);
        }
        return t;
    }

    // Escape + protect fenced/inline code as placeholders. Returns the protected
    // string plus the arrays needed to restore them.
    function protectCode(text) {
        let s = escapeHtml(text);
        const codeBlocks = [];
        s = s.replace(/```[a-zA-Z0-9+#._-]*\r?\n?([\s\S]*?)```/g, (m, code) => {
            codeBlocks.push(code.replace(/\r?\n$/, ''));
            return `${MD_NUL}BLOCK${codeBlocks.length - 1}${MD_NUL}`;
        });
        const codeSpans = [];
        s = s.replace(/`([^`\n]+)`/g, (m, code) => {
            codeSpans.push(code);
            return `${MD_NUL}CODE${codeSpans.length - 1}${MD_NUL}`;
        });
        return { s, codeBlocks, codeSpans };
    }
    function restoreCode(s, codeBlocks, codeSpans) {
        s = s.replace(new RegExp(MD_NUL + 'CODE(\\d+)' + MD_NUL, 'g'),
            (m, i) => `<code>${codeSpans[Number(i)]}</code>`);
        s = s.replace(new RegExp(MD_NUL + 'BLOCK(\\d+)' + MD_NUL, 'g'),
            (m, i) => `<pre class="code-block"><code>${codeBlocks[Number(i)]}</code></pre>`);
        return s;
    }

    // Inline-only renderer for single-line contexts (task and subtask titles):
    // no headings/lists/paragraphs, just the inline set above. Emoji shortcodes
    // are enabled here too, so ":rocket:" renders in titles as it does in notes.
    function linkify(text) {
        if (!text) return '';
        const { s, codeBlocks, codeSpans } = protectCode(text);
        return restoreCode(applyInline(s, { emoji: true }), codeBlocks, codeSpans);
    }

    // Full block renderer for notes/descriptions: headings, lists, blockquotes,
    // horizontal rules, fenced code, and paragraphs - with inline formatting
    // applied within each block. Line-based; escape-first, whitelist-only output.
    function renderNote(text) {
        if (!text) return '';
        const { s, codeBlocks, codeSpans } = protectCode(text);
        const lines = s.split('\n');
        const blockPlaceholder = new RegExp('^' + MD_NUL + 'BLOCK(\\d+)' + MD_NUL + '$');
        const isSpecial = (lt) =>
            lt === '' ||
            /^#{1,6}\s+/.test(lt) ||
            /^[-*]\s+/.test(lt) ||
            /^\d+\.\s+/.test(lt) ||
            /^&gt;\s?/.test(lt) ||
            /^(-{3,}|\*{3,})$/.test(lt) ||
            blockPlaceholder.test(lt);

        const out = [];
        let i = 0;
        while (i < lines.length) {
            const lt = lines[i].trim();
            if (lt === '') { i++; continue; }

            const bp = lt.match(blockPlaceholder);
            if (bp) { out.push(`${MD_NUL}BLOCK${bp[1]}${MD_NUL}`); i++; continue; }

            if (/^(-{3,}|\*{3,})$/.test(lt)) { out.push('<hr>'); i++; continue; }

            const h = lt.match(/^(#{1,6})\s+(.*)$/);
            if (h) { const n = h[1].length; out.push(`<h${n}>${applyInline(h[2], { emoji: true })}</h${n}>`); i++; continue; }

            if (/^&gt;\s?/.test(lt)) {
                const buf = [];
                while (i < lines.length && /^&gt;\s?/.test(lines[i].trim())) {
                    buf.push(applyInline(lines[i].trim().replace(/^&gt;\s?/, ''), { emoji: true }));
                    i++;
                }
                out.push(`<blockquote>${buf.join('<br>')}</blockquote>`);
                continue;
            }
            if (/^[-*]\s+/.test(lt)) {
                const buf = [];
                while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
                    buf.push(`<li>${applyInline(lines[i].trim().replace(/^[-*]\s+/, ''), { emoji: true })}</li>`);
                    i++;
                }
                out.push(`<ul>${buf.join('')}</ul>`);
                continue;
            }
            if (/^\d+\.\s+/.test(lt)) {
                const buf = [];
                while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
                    buf.push(`<li>${applyInline(lines[i].trim().replace(/^\d+\.\s+/, ''), { emoji: true })}</li>`);
                    i++;
                }
                out.push(`<ol>${buf.join('')}</ol>`);
                continue;
            }
            // Paragraph: gather consecutive plain lines, join with <br>.
            const buf = [];
            while (i < lines.length && !isSpecial(lines[i].trim())) {
                buf.push(applyInline(lines[i].trim(), { emoji: true }));
                i++;
            }
            out.push(`<p>${buf.join('<br>')}</p>`);
        }
        return restoreCode(out.join(''), codeBlocks, codeSpans);
    }

    function toLocalDateKey(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // "Aug 14" for completions in the current year, "Aug 14, 2025" otherwise -
    // keeps the ledger column tight for recent items while staying unambiguous
    // for older ones. Takes an ISO string (what completionDate stores).
    function formatCompletionDate(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const opts = { month: 'short', day: 'numeric' };
        if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
        return d.toLocaleDateString(undefined, opts);
    }

    function formatShortDate(dateStr) {
        if (!dateStr) return '';
        const date = new Date(dateStr + 'T00:00:00');
        return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function formatTime(timeStr) {
        if (!timeStr) return '';
        const [hours, minutes] = timeStr.split(':').map(Number);
        const date = new Date(2000, 0, 1, hours, minutes);
        return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }

    // Markdown-style typing shortcuts for the new-task input: "/today",
    // "/tomorrow", "/yesterday" expand in place to a full written-out date
    // (e.g. "Thu, Aug 21, 2026") - fixed to 'en-US' so the format is the same
    // regardless of the OS/browser locale.
    const SLASH_DATE_OFFSETS = { today: 0, tomorrow: 1, yesterday: -1 };
    const SLASH_DATE_PATTERN = /\/(today|tomorrow|yesterday)\b/i;
    function formatSlashDate(offsetDays) {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }
    function expandSlashDateShortcuts(text) {
        return text.replace(new RegExp(SLASH_DATE_PATTERN, 'gi'), (match, word) =>
            formatSlashDate(SLASH_DATE_OFFSETS[word.toLowerCase()])
        );
    }

    // A due date with no time is treated as "due by end of that day" - this
    // preserves the original date-only behavior (a task due "today" isn't
    // overdue until tomorrow) while letting a due time make a task overdue
    // at that exact moment instead of only at midnight.
    function getTaskDueDateTime(task) {
        if (!task.dueDate) return null;
        if (task.dueTime) return new Date(`${task.dueDate}T${task.dueTime}:00`);
        return new Date(`${task.dueDate}T23:59:59.999`);
    }
    function isTaskOverdue(task) {
        if (!task.dueDate || task.completed) return false;
        return getTaskDueDateTime(task) < new Date();
    }

    // A snoozed task is hidden through the end of its snooze date - same
    // date-only "through end of day" rule as a due date with no time, so a
    // task snoozed for "today" reappears tomorrow rather than immediately.
    function isTaskSnoozed(task) {
        if (!task.snoozedUntil || task.completed) return false;
        return new Date(`${task.snoozedUntil}T23:59:59.999`) > new Date();
    }
    // "Tomorrow" / "in N days" - deliberately simple (no week-bucketing) so
    // the wording always matches the exact quick-pick option that produced it.
    function formatSnoozeRelative(snoozedUntil) {
        const todayKey = toLocalDateKey(new Date());
        const diffDays = Math.round((new Date(snoozedUntil + 'T00:00:00') - new Date(todayKey + 'T00:00:00')) / 86400000);
        if (diffDays <= 0) return 'Today';
        if (diffDays === 1) return 'Tomorrow';
        return `in ${diffDays} days`;
    }
    function addDaysKey(n) {
        const d = new Date();
        d.setDate(d.getDate() + n);
        return toLocalDateKey(d);
    }
    // Always strictly in the future, even if today is Monday.
    function nextMondayKey() {
        const d = new Date();
        const diff = (8 - d.getDay()) % 7 || 7;
        d.setDate(d.getDate() + diff);
        return toLocalDateKey(d);
    }

    // Matches the r="7" circle in the #subtask-progress-ring template.
    const PROGRESS_RING_CIRCUMFERENCE = 2 * Math.PI * 7;

    // --- FILE HANDLE PERSISTENCE (IndexedDB) ---
    // FileSystemFileHandle objects are structured-cloneable, so they can be stored
    // directly in IndexedDB and re-acquired across reloads (unlike localStorage).
    const HANDLE_DB_NAME = 'todoAppFileHandleDB';
    const HANDLE_STORE_NAME = 'handles';
    const HANDLE_KEY = 'autosave-handle';

    function openHandleDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(HANDLE_DB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(HANDLE_STORE_NAME);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    async function getStoredHandle() {
        const db = await openHandleDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
            const req = tx.objectStore(HANDLE_STORE_NAME).get(HANDLE_KEY);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }
    async function setStoredHandle(handle) {
        const db = await openHandleDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
            tx.objectStore(HANDLE_STORE_NAME).put(handle, HANDLE_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
    async function clearStoredHandle() {
        const db = await openHandleDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
            tx.objectStore(HANDLE_STORE_NAME).delete(HANDLE_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // --- COMPONENT DEFINITIONS ---

    const SubtaskItem = {
        template: '#subtask-item-template',
        props: ['subtask', 'parentCompleted', 'taskId'],
        emits: ['update', 'delete'],
        setup(props, { emit }) {
            // Opens the shared note overlay (provided by the root) for this subtask.
            const noteApi = inject('noteApi', null);
            const openNote = () => noteApi && noteApi.open({
                kind: 'subtask', taskId: props.taskId, subtaskId: props.subtask.id, title: props.subtask.text,
            });
            const isEditing = ref(false);
            const editText = ref('');
            const editInputRef = ref(null);

            const startEditing = () => {
                if (props.parentCompleted) return;
                editText.value = props.subtask.text;
                isEditing.value = true;
                nextTick(() => editInputRef.value?.focus());
            };
            const saveEdit = () => {
                if (!isEditing.value) return;
                const trimmed = editText.value.trim();
                if (trimmed) {
                    emit('update', { ...props.subtask, text: trimmed });
                }
                isEditing.value = false;
            };
            const cancelEdit = () => { isEditing.value = false; };
            const toggleComplete = () => {
                const completed = !props.subtask.completed;
                // Stamp on completion, clear on un-complete - same semantics as a
                // task's own completionDate, so re-checking gives a fresh date.
                emit('update', {
                    ...props.subtask,
                    completed,
                    completionDate: completed ? new Date().toISOString() : null,
                });
            };
            const completedOn = computed(() => formatCompletionDate(props.subtask.completionDate));

            // Long subtasks are clamped to two lines so one wordy item can't push
            // the rest of the card off screen. The more/less control only appears
            // when the text genuinely overflows, which has to be measured rather
            // than guessed from length (wrapping depends on the rendered width).
            const textRef = ref(null);
            const isTextExpanded = ref(false);
            const isOverflowing = ref(false);
            const measureOverflow = () => {
                const el = textRef.value;
                // Only meaningful while clamped - once expanded, scrollHeight and
                // clientHeight match by definition, so skip and keep the last value.
                if (!el || isTextExpanded.value) return;
                isOverflowing.value = el.scrollHeight - el.clientHeight > 1;
            };
            const toggleTextExpanded = () => { isTextExpanded.value = !isTextExpanded.value; };

            let resizeObserver = null;
            onMounted(() => {
                nextTick(measureOverflow);
                // Re-measure on width changes (window resize, card expand/collapse),
                // since the same text wraps differently at different widths.
                if (typeof ResizeObserver !== 'undefined' && textRef.value) {
                    resizeObserver = new ResizeObserver(measureOverflow);
                    resizeObserver.observe(textRef.value);
                }
            });
            onUnmounted(() => resizeObserver?.disconnect());
            watch(() => props.subtask.text, () => nextTick(measureOverflow));

            return {
                isEditing, editText, editInputRef, startEditing, saveEdit, cancelEdit, toggleComplete, linkify, emit,
                textRef, isTextExpanded, isOverflowing, toggleTextExpanded, completedOn, openNote,
            };
        }
    };

    const SubtaskList = {
        template: '#subtask-list-template',
        components: { 'subtask-item': SubtaskItem },
        props: ['task'],
        emits: ['update-subtasks'],
        setup(props, { emit }) {
            const newSubtaskText = ref('');
            const listRef = ref(null);
            let sortableInstance = null;

            const sortedSubtasks = computed(() => {
                if (!props.task.subtasks) return [];
                return [...props.task.subtasks].sort((a, b) => (a.completed - b.completed) || ((a.order ?? 0) - (b.order ?? 0)));
            });

            const addSubtask = () => {
                const text = newSubtaskText.value.trim();
                if (!text) return;
                // Subtasks read as a sequence of steps, so new ones append to the
                // BOTTOM (first come, first served) - unlike top-level tasks, where
                // the newest goes to the top. Only incomplete subtasks matter here:
                // completed ones always sort below regardless of their order value.
                const incomplete = (props.task.subtasks || []).filter(st => !st.completed);
                const maxOrder = incomplete.reduce((max, st) => Math.max(max, st.order ?? 0), 0);
                const newSubtask = { id: Date.now().toString(), text, completed: false, completionDate: null, note: '', order: maxOrder + 1 };
                const updatedSubtasks = [...(props.task.subtasks || []), newSubtask];
                emit('update-subtasks', updatedSubtasks);
                newSubtaskText.value = '';
            };
            const updateSubtask = (updatedSubtask) => {
                const updatedSubtasks = props.task.subtasks.map(st => st.id === updatedSubtask.id ? updatedSubtask : st);
                emit('update-subtasks', updatedSubtasks);
            };
            const deleteSubtask = (subtaskId) => {
                const updatedSubtasks = props.task.subtasks.filter(st => st.id !== subtaskId);
                emit('update-subtasks', updatedSubtasks);
            };

            onMounted(() => {
                if (listRef.value) {
                    sortableInstance = new Sortable(listRef.value, {
                        handle: '.subtask-drag-handle', animation: 150, ghostClass: 'dragging',
                        filter: '.completed', preventOnFilter: false,
                        forceFallback: true, fallbackClass: 'dragging-fallback', fallbackTolerance: 3,
                        onEnd: (evt) => {
                            if (evt.oldIndex === evt.newIndex) return;
                            const incomplete = sortedSubtasks.value.filter(st => !st.completed);
                            const completed = sortedSubtasks.value.filter(st => st.completed);
                            if (evt.oldIndex >= incomplete.length) return;
                            const clampedNewIndex = Math.min(evt.newIndex, incomplete.length - 1);
                            const [movedItem] = incomplete.splice(evt.oldIndex, 1);
                            incomplete.splice(clampedNewIndex, 0, movedItem);
                            const reindexed = incomplete.map((st, index) => ({ ...st, order: index }));
                            emit('update-subtasks', [...reindexed, ...completed]);
                        }
                    });
                }
            });
            onUnmounted(() => sortableInstance?.destroy());

            return { newSubtaskText, sortedSubtasks, addSubtask, updateSubtask, deleteSubtask, listRef };
        }
    };

    const TaskItem = {
        template: '#task-item-template',
        components: { 'subtask-list': SubtaskList },
        props: {
            task: { type: Object, required: true },
            selectionMode: { type: Boolean, default: false },
            selected: { type: Boolean, default: false },
            expanded: { type: Boolean, default: false },
        },
        emits: ['update-task', 'delete-task', 'toggle-select', 'filter-by-tag', 'set-task-expanded'],
        setup(props, { emit }) {
            const isEditing = ref(false);
            const editText = ref('');
            const editInputRef = ref(null);
            const newTagText = ref('');
            const isEditingDueDate = ref(false);
            const dueDateInputRef = ref(null);
            const isAddingTag = ref(false);
            const tagInputRef = ref(null);
            const isSnoozing = ref(false);

            // `expanded` is watched alongside the task data because collapsing a row
            // re-creates elements gated on it (the due badge and its <i data-feather>
            // icon). Without this, those icons stayed as unprocessed <i> placeholders
            // and silently rendered nothing - feather.replace() only ran on task-data
            // changes, search, theme and mount.
            watch(() => [props.task, props.expanded], () => {
                 nextTick(() => feather.replace());
            }, { deep: true });

            // Expand/collapse state lives in the root's expandedTaskIds (keyed by
            // task id), not a local ref here - a local ref would reset to false
            // whenever this component unmounts/remounts, which happens whenever the
            // task is filtered out of view (search) or moves between the pending
            // and completed lists (they're separate v-for trees in separate
            // components, so Vue can't preserve this instance across that move).
            const setExpanded = (value) => {
                emit('set-task-expanded', { taskId: props.task.id, expanded: value });
            };
            const toggleDetails = () => {
                setExpanded(!props.expanded);
            };

            const startEditing = () => {
                if (props.task.completed) return;
                editText.value = props.task.text;
                isEditing.value = true;
                nextTick(() => editInputRef.value?.focus());
            };
            const saveEdit = () => {
                if (!isEditing.value) return;
                const trimmed = editText.value.trim();
                if (trimmed) {
                    emit('update-task', { ...props.task, text: trimmed });
                }
                isEditing.value = false;
            };
            const cancelEdit = () => { isEditing.value = false; };
            const toggleComplete = () => {
                const isCompleted = !props.task.completed;
                emit('update-task', { ...props.task, completed: isCompleted, completionDate: isCompleted ? new Date().toISOString() : null });
                if (isCompleted) setExpanded(false);
            };
            const handleCheckboxChange = () => {
                if (props.selectionMode) {
                    emit('toggle-select');
                } else {
                    toggleComplete();
                }
            };
            const toggleImportance = () => {
                 emit('update-task', { ...props.task, isImportant: !props.task.isImportant });
            };
            const handleDelete = () => {
                emit('delete-task', props.task.id);
            };
            // Notes now open in the shared overlay editor (provided by the root)
            // instead of an inline textarea, so a multi-page note gets real room and
            // doesn't stretch the card. The task's note is stored in `description`
            // (kept as the data key to avoid a migration; surfaced as "Notes").
            const noteApi = inject('noteApi', null);
            const openTaskNote = () => noteApi && noteApi.open({
                kind: 'task', taskId: props.task.id, title: props.task.text,
            });
            const handleSubtasksUpdate = (updatedSubtasks) => {
                emit('update-task', { ...props.task, subtasks: updatedSubtasks });
            };
            const setDueDate = (value) => {
                const dueDate = value || null;
                // Time is meaningless without a date, so clearing the date clears
                // the time too rather than leaving an orphaned dueTime behind.
                emit('update-task', { ...props.task, dueDate, dueTime: dueDate ? props.task.dueTime : null });
            };
            const setDueTime = (value) => {
                emit('update-task', { ...props.task, dueTime: value || null });
            };
            const startEditingDueDate = () => {
                isEditingDueDate.value = true;
                nextTick(() => dueDateInputRef.value?.focus());
            };
            // The date and time inputs are two separate elements in the same
            // editing group - tabbing from one to the other must not collapse the
            // group, so this checks focus is leaving the group entirely (not just
            // one input) before closing it, rather than using a plain @blur.
            const toggleSnoozing = () => { isSnoozing.value = !isSnoozing.value; };
            // Same focus-trap-free auto-close as the due-date editor: only
            // collapse when focus leaves the whole editor group, not when it
            // moves between the quick-pick buttons and the date input.
            const handleSnoozeFocusOut = (event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    isSnoozing.value = false;
                }
            };
            const snoozeUntilDate = (dateStr) => {
                emit('update-task', { ...props.task, snoozedUntil: dateStr });
                // Same reset-on-transition as completing a task (toggleComplete
                // above) - it's moving to a different list, so it should start
                // collapsed there regardless of how it was left in Pending.
                setExpanded(false);
                isSnoozing.value = false;
            };
            const pickSnooze = (kind) => {
                if (kind === 'tomorrow') snoozeUntilDate(addDaysKey(1));
                else if (kind === 'nextMonday') snoozeUntilDate(nextMondayKey());
                else if (kind === 'week') snoozeUntilDate(addDaysKey(7));
            };
            const pickSnoozeDate = (value) => {
                if (value) snoozeUntilDate(value);
            };
            const clearSnooze = () => {
                emit('update-task', { ...props.task, snoozedUntil: null });
            };
            const snoozeMinDate = computed(() => toLocalDateKey(new Date()));
            const snoozeRelative = computed(() => formatSnoozeRelative(props.task.snoozedUntil));
            const snoozeAbsolute = computed(() => formatShortDate(props.task.snoozedUntil));
            const handleDueEditFocusOut = (event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    isEditingDueDate.value = false;
                }
            };
            const addTag = () => {
                const tag = newTagText.value.trim();
                if (!tag) return;
                const existing = props.task.tags || [];
                if (!existing.includes(tag)) {
                    emit('update-task', { ...props.task, tags: [...existing, tag] });
                }
                newTagText.value = '';
                // Deliberately left open (not collapsed back to the "+ tag" pill) so
                // several tags can be added back-to-back with Enter, Enter, Enter.
            };
            const removeTag = (tag) => {
                emit('update-task', { ...props.task, tags: (props.task.tags || []).filter(t => t !== tag) });
            };
            const filterByTag = (tag) => {
                emit('filter-by-tag', tag);
            };
            const startAddingTag = () => {
                isAddingTag.value = true;
                nextTick(() => tagInputRef.value?.focus());
            };
            const cancelAddingTag = () => {
                newTagText.value = '';
                isAddingTag.value = false;
            };
            const handleTagInputBlur = () => {
                if (!newTagText.value.trim()) isAddingTag.value = false;
            };

            const isOverdue = computed(() => isTaskOverdue(props.task));
            const formattedDueDate = computed(() => formatShortDate(props.task.dueDate));
            const formattedDueTime = computed(() => formatTime(props.task.dueTime));
            const linkifiedDescription = computed(() => renderNote(props.task.description));

            // Descriptions are bounded by max-height rather than -webkit-line-clamp
            // (which subtasks use): a description can contain block children - a
            // fenced <pre> code block - and line-clamp only clamps inline content
            // reliably. Same measure-then-offer-a-toggle approach otherwise.
            const descRef = ref(null);
            const isDescExpanded = ref(false);
            const isDescOverflowing = ref(false);
            const measureDescOverflow = () => {
                const el = descRef.value;
                if (!el || isDescExpanded.value) return;
                isDescOverflowing.value = el.scrollHeight - el.clientHeight > 1;
            };
            const toggleDescExpanded = () => { isDescExpanded.value = !isDescExpanded.value; };
            let descResizeObserver = null;
            onMounted(() => {
                nextTick(measureDescOverflow);
                if (typeof ResizeObserver !== 'undefined' && descRef.value) {
                    descResizeObserver = new ResizeObserver(measureDescOverflow);
                    descResizeObserver.observe(descRef.value);
                }
            });
            onUnmounted(() => descResizeObserver?.disconnect());
            watch(() => props.task.description, () => nextTick(measureDescOverflow));
            const subtaskProgress = computed(() => {
                const subtasks = props.task.subtasks || [];
                if (subtasks.length === 0) return null;
                const done = subtasks.filter(st => st.completed).length;
                return `${done}/${subtasks.length}`;
            });
            const subtaskProgressRingOffset = computed(() => {
                const subtasks = props.task.subtasks || [];
                if (subtasks.length === 0) return PROGRESS_RING_CIRCUMFERENCE;
                const ratio = subtasks.filter(st => st.completed).length / subtasks.length;
                return PROGRESS_RING_CIRCUMFERENCE * (1 - ratio);
            });

            return {
                isEditing, editText, editInputRef,
                toggleDetails, startEditing, saveEdit, cancelEdit, toggleComplete, handleCheckboxChange, toggleImportance,
                handleDelete, linkify, openTaskNote, handleSubtasksUpdate,
                setDueDate, setDueTime, isOverdue, formattedDueDate, formattedDueTime, linkifiedDescription,
                subtaskProgress, subtaskProgressRingOffset,
                newTagText, addTag, removeTag, filterByTag,
                isEditingDueDate, dueDateInputRef, startEditingDueDate, handleDueEditFocusOut,
                isAddingTag, tagInputRef, startAddingTag, cancelAddingTag, handleTagInputBlur,
                descRef, isDescExpanded, isDescOverflowing, toggleDescExpanded,
                isSnoozing, toggleSnoozing, handleSnoozeFocusOut, pickSnooze, pickSnoozeDate,
                clearSnooze, snoozeMinDate, snoozeRelative, snoozeAbsolute
            };
        }
    };

    const TaskList = {
        template: '#task-list-template',
        components: { 'task-item': TaskItem },
        props: {
            tasks: { type: Array, required: true },
            emptyMessage: { type: String, default: 'No pending tasks. Add one above!' },
            expandedTaskIds: { type: Set, default: () => new Set() },
            dragDisabled: { type: Boolean, default: false },
        },
        emits: ['update-task', 'delete-task', 'order-update', 'filter-by-tag', 'set-task-expanded'],
        setup(props, { emit }) {
            const listRef = ref(null);
            let sortableInstance = null;
            onMounted(() => {
                if (listRef.value) {
                    sortableInstance = new Sortable(listRef.value, {
                        disabled: props.dragDisabled,
                        handle: ".drag-handle", animation: 150, ghostClass: "dragging",
                        forceFallback: true, fallbackClass: 'dragging-fallback', fallbackTolerance: 3,
                        onEnd: (evt) => {
                            if (evt.oldIndex === evt.newIndex) return;
                            const reorderedTasks = [...props.tasks];
                            const [movedItem] = reorderedTasks.splice(evt.oldIndex, 1);
                            reorderedTasks.splice(evt.newIndex, 0, movedItem);
                            emit('order-update', reorderedTasks);
                        }
                    });
                }
            });
            onUnmounted(() => sortableInstance?.destroy());
            // Keep Sortable in step with the toggle without tearing it down.
            watch(() => props.dragDisabled, (disabled) => {
                sortableInstance?.option('disabled', disabled);
            });
            return { listRef, emit };
        }
    };

    const CompletedTasks = {
        template: '#completed-tasks-template',
        components: { 'task-item': TaskItem },
        props: {
            tasks: { type: Array, required: true },
            emptyMessage: { type: String, default: 'No completed tasks yet.' },
            expandedTaskIds: { type: Set, default: () => new Set() },
        },
        emits: ['update-task', 'delete-task', 'delete-many', 'clear-completed', 'filter-by-tag', 'set-task-expanded'],
        setup(props, { emit }) {
            const isSelecting = ref(false);
            const selectedIds = ref(new Set());

            const groupedTasks = computed(() => {
                const groups = props.tasks.reduce((acc, task) => {
                    const dateKey = task.completionDate ? toLocalDateKey(task.completionDate) : "Unknown Date";
                    if (!acc[dateKey]) acc[dateKey] = [];
                    acc[dateKey].push(task);
                    return acc;
                }, {});
                return Object.keys(groups).sort((a, b) => (a === "Unknown Date") ? 1 : (b === "Unknown Date") ? -1 : new Date(b) - new Date(a)).map(dateKey => ({
                    date: dateKey, tasks: groups[dateKey]
                }));
            });
            const formatDate = (dateStr) => {
                if (dateStr === "Unknown Date") return dateStr;
                const date = new Date(dateStr + 'T00:00:00');
                const today = new Date();
                const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
                if (date.toDateString() === today.toDateString()) return "Today";
                if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
                return date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
            };

            const toggleSelect = (id) => {
                const s = new Set(selectedIds.value);
                if (s.has(id)) s.delete(id); else s.add(id);
                selectedIds.value = s;
            };
            const cancelSelecting = () => {
                isSelecting.value = false;
                selectedIds.value = new Set();
            };
            const deleteSelected = () => {
                if (selectedIds.value.size === 0) return;
                emit('delete-many', Array.from(selectedIds.value));
                cancelSelecting();
            };
            const handleClearCompleted = () => {
                if (props.tasks.length === 0) return;
                emit('clear-completed');
            };

            return {
                emit, groupedTasks, formatDate, isSelecting, selectedIds,
                toggleSelect, cancelSelecting, deleteSelected, handleClearCompleted
            };
        }
    };

    // Deliberately minimal next to CompletedTasks: no bulk-select, no date
    // grouping - the list is small and sorted by return date, not manually
    // organized. Needs its own component (not just a <ul> in the root
    // template) purely so it can locally register 'task-item': TaskItem,
    // the same reason TaskList and CompletedTasks each do - <task-item> isn't
    // registered globally.
    const SnoozedTasks = {
        template: '#snoozed-tasks-template',
        components: { 'task-item': TaskItem },
        props: {
            tasks: { type: Array, required: true },
            expandedTaskIds: { type: Set, default: () => new Set() },
        },
        emits: ['update-task', 'delete-task', 'filter-by-tag', 'set-task-expanded'],
        setup(props, { emit }) {
            return { emit };
        }
    };

    // --- MAIN VUE APPLICATION ---
    createApp({
        setup() {
            const STORAGE_KEY = "enhancedTodoAppTasks_vue_v2";
            const tasks = ref([]);
            const newTaskText = ref("");
            const searchQuery = ref("");
            // Keyed by task id (not tied to any one component instance) so a task's
            // expanded/collapsed state survives search filtering it in/out of view,
            // or completing/uncompleting it (which moves it between the separate
            // pending and completed list components). Persisted separately from the
            // tasks themselves (its own localStorage key, never written to the
            // auto-save file) since it's UI preference, not task data.
            const EXPANDED_TASKS_KEY = "enhancedTodoAppExpandedTaskIds_v1";
            const loadExpandedTaskIds = () => {
                try {
                    const stored = JSON.parse(localStorage.getItem(EXPANDED_TASKS_KEY) || "[]");
                    return new Set(Array.isArray(stored) ? stored : []);
                } catch (e) {
                    return new Set();
                }
            };
            const expandedTaskIds = ref(loadExpandedTaskIds());
            const setTaskExpanded = ({ taskId, expanded }) => {
                const s = new Set(expandedTaskIds.value);
                if (expanded) s.add(taskId); else s.delete(taskId);
                expandedTaskIds.value = s;
                localStorage.setItem(EXPANDED_TASKS_KEY, JSON.stringify(Array.from(s)));
            };
            const toast = ref(null);
            let toastTimer = null;
            const showToast = (message, options = {}) => {
                clearTimeout(toastTimer);
                toast.value = {
                    message,
                    actionLabel: options.actionLabel || null,
                    onAction: options.onAction || null,
                    variant: options.variant || 'default',
                };
                toastTimer = setTimeout(() => { toast.value = null; }, options.duration || 6000);
            };
            const dismissToast = () => {
                clearTimeout(toastTimer);
                toast.value = null;
            };
            const handleToastAction = () => {
                if (toast.value?.onAction) toast.value.onAction();
                dismissToast();
            };

            // --- Overdue task alerting ---
            // Dedup bookkeeping lives in its own localStorage key (never the
            // auto-save file - it's alert state, not task data), keyed by task id
            // -> the local date it was last alerted on, so a still-overdue task
            // alerts again once per calendar day rather than nagging on every
            // 15-minute check, but also isn't silenced forever after one dismiss.
            const NOTIFIED_OVERDUE_KEY = "enhancedTodoAppNotifiedOverdue_v1";
            const loadNotifiedOverdueTasks = () => {
                try {
                    const stored = JSON.parse(localStorage.getItem(NOTIFIED_OVERDUE_KEY) || "{}");
                    return (stored && typeof stored === 'object' && !Array.isArray(stored)) ? stored : {};
                } catch (e) {
                    return {};
                }
            };
            const notifiedOverdueTasks = ref(loadNotifiedOverdueTasks());
            // Deliberately a separate ref from `toast` above - toast holds exactly
            // one message at a time and would otherwise get clobbered by (or
            // clobber) an in-flight undo toast whenever both want to show at once.
            const overdueAlert = ref(null);
            const dismissOverdueAlert = () => { overdueAlert.value = null; };

            const COMPLETED_SECTION_COLLAPSED_KEY = 'completedSectionCollapsed';
            const completedSectionCollapsed = ref(localStorage.getItem(COMPLETED_SECTION_COLLAPSED_KEY) === '1');
            const toggleCompletedSection = () => {
                completedSectionCollapsed.value = !completedSectionCollapsed.value;
                localStorage.setItem(COMPLETED_SECTION_COLLAPSED_KEY, completedSectionCollapsed.value ? '1' : '0');
            };

            const NOTIFICATION_SUPPORTED = typeof Notification !== 'undefined';
            const notificationPermission = ref(NOTIFICATION_SUPPORTED ? Notification.permission : 'unsupported');
            const NOTIFY_BANNER_KEY = 'overdueNotifyBannerDismissed';
            const notifyBannerDismissed = ref(localStorage.getItem(NOTIFY_BANNER_KEY) === '1');
            const showNotifyBanner = computed(() =>
                NOTIFICATION_SUPPORTED && notificationPermission.value === 'default' && !notifyBannerDismissed.value
            );
            const dismissNotifyBanner = () => {
                notifyBannerDismissed.value = true;
                localStorage.setItem(NOTIFY_BANNER_KEY, '1');
            };
            const enableOverdueNotifications = async () => {
                if (!NOTIFICATION_SUPPORTED) return;
                const permission = await Notification.requestPermission();
                notificationPermission.value = permission;
                dismissNotifyBanner();
            };

            const showOverdueAlert = (newlyDueTasks) => {
                const message = newlyDueTasks.length === 1
                    ? `"${newlyDueTasks[0].text}" is overdue`
                    : (() => {
                        const names = newlyDueTasks.slice(0, 2).map(t => t.text);
                        const remaining = newlyDueTasks.length - names.length;
                        const list = remaining > 0 ? `${names.join(', ')}, +${remaining} more` : names.join(', ');
                        return `${newlyDueTasks.length} tasks are overdue: ${list}`;
                    })();
                overdueAlert.value = { message };
                if (NOTIFICATION_SUPPORTED && Notification.permission === 'granted') {
                    const notification = new Notification('Overdue tasks', { body: message });
                    notification.onclick = () => window.focus();
                }
            };

            const checkOverdueTasks = () => {
                const todayKey = toLocalDateKey(new Date());
                const overdueNow = tasks.value.filter(isTaskOverdue);
                const overdueIds = new Set(overdueNow.map(t => t.id));

                // Drop entries for tasks that are no longer overdue (completed,
                // deleted, or edited back into the future) so a later recurrence
                // of overdue-ness always gets a fresh alert instead of being
                // silently suppressed by stale bookkeeping.
                const next = {};
                for (const id of Object.keys(notifiedOverdueTasks.value)) {
                    if (overdueIds.has(id)) next[id] = notifiedOverdueTasks.value[id];
                }
                const newlyDue = overdueNow.filter(t => next[t.id] !== todayKey);
                if (newlyDue.length > 0) {
                    newlyDue.forEach(t => { next[t.id] = todayKey; });
                    showOverdueAlert(newlyDue);
                }
                notifiedOverdueTasks.value = next;
                localStorage.setItem(NOTIFIED_OVERDUE_KEY, JSON.stringify(next));
            };
            let overdueCheckInterval = null;

            // Brings a task back from snooze the moment its date has passed -
            // same trigger points as checkOverdueTasks (mount, 15-min interval,
            // and the tasks watcher) so a snooze into the past resolves promptly
            // instead of waiting up to 15 minutes.
            const checkSnoozedTasks = () => {
                const dueBack = tasks.value.filter(t => !t.completed && t.snoozedUntil && !isTaskSnoozed(t));
                if (dueBack.length === 0) return;
                const dueBackIds = new Set(dueBack.map(t => t.id));
                tasks.value = tasks.value.map(t => dueBackIds.has(t.id) ? { ...t, snoozedUntil: null } : t);
                const message = dueBack.length === 1
                    ? `"${dueBack[0].text}" is back from snooze`
                    : `${dueBack.length} tasks are back from snooze`;
                showToast(message);
            };

            const theme = ref(
                localStorage.getItem('theme') ||
                (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            );

            const applyTheme = () => {
                document.documentElement.setAttribute('data-theme', theme.value);
                localStorage.setItem('theme', theme.value);
                nextTick(() => feather.replace());
            };
            const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const toggleTheme = (event) => {
                const nextTheme = theme.value === 'dark' ? 'light' : 'dark';
                if (!document.startViewTransition || prefersReducedMotion) {
                    theme.value = nextTheme;
                    applyTheme();
                    return;
                }
                const x = event?.clientX ?? window.innerWidth / 2;
                const y = event?.clientY ?? window.innerHeight / 2;
                const endRadius = Math.hypot(
                    Math.max(x, window.innerWidth - x),
                    Math.max(y, window.innerHeight - y)
                );
                const transition = document.startViewTransition(() => {
                    theme.value = nextTheme;
                    applyTheme();
                });
                // `ready` rejects (not just skips) when the transition is aborted -
                // e.g. the tab is hidden, the page navigates away mid-transition, or
                // another transition starts first. The theme itself has already been
                // applied by then, so swallow it rather than leaving an unhandled
                // promise rejection in the console.
                transition.ready.then(() => {
                    document.documentElement.animate(
                        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
                        { duration: 400, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
                    );
                }).catch(() => {});
            };

            const fileAccessSupported = typeof window.showSaveFilePicker === 'function';
            const autoSaveState = ref('disconnected'); // 'disconnected' | 'connected' | 'reconnect-needed'
            let fileHandle = null;
            const AUTO_SAVE_BANNER_KEY = 'autoSaveBannerDismissed';
            const autoSaveBannerDismissed = ref(localStorage.getItem(AUTO_SAVE_BANNER_KEY) === '1');
            const dismissAutoSaveBanner = () => {
                autoSaveBannerDismissed.value = true;
                localStorage.setItem(AUTO_SAVE_BANNER_KEY, '1');
            };
            // Once the banner's one-time nudge is dismissed (or the user connects
            // via it), the footer button takes over as the permanent control -
            // never show both at once.
            const showAutoSaveBanner = computed(() =>
                fileAccessSupported && autoSaveState.value === 'disconnected' && !autoSaveBannerDismissed.value
            );
            const showAutoSaveFooterButton = computed(() =>
                fileAccessSupported && (autoSaveState.value !== 'disconnected' || autoSaveBannerDismissed.value)
            );

            const autoSaveLabel = computed(() => {
                if (autoSaveState.value === 'connected') return 'Auto-saving';
                if (autoSaveState.value === 'reconnect-needed') return 'Reconnect auto-save';
                return 'Enable auto-save';
            });

            const writeToFile = async (data) => {
                if (!fileHandle) return;
                try {
                    const writable = await fileHandle.createWritable();
                    await writable.write(JSON.stringify(data, null, 2));
                    await writable.close();
                } catch (e) {
                    autoSaveState.value = 'reconnect-needed';
                }
            };
            const connectAutoSave = async () => {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: 'tasks.json',
                        types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }],
                    });
                    fileHandle = handle;
                    await setStoredHandle(handle);
                    autoSaveState.value = 'connected';
                    dismissAutoSaveBanner();
                    await writeToFile(tasks.value);
                    showToast(`Auto-save enabled — writing to "${handle.name}"`);
                } catch (e) {
                    if (e.name !== 'AbortError') showToast('Could not enable auto-save.', { variant: 'error' });
                }
            };
            const disconnectAutoSave = async () => {
                fileHandle = null;
                autoSaveState.value = 'disconnected';
                await clearStoredHandle();
            };
            const reconnectAutoSave = async () => {
                if (!fileHandle) return;
                try {
                    const permission = await fileHandle.requestPermission({ mode: 'readwrite' });
                    if (permission === 'granted') {
                        autoSaveState.value = 'connected';
                        await writeToFile(tasks.value);
                    }
                } catch (e) {
                    showToast('Could not reconnect auto-save.', { variant: 'error' });
                }
            };
            const handleAutoSaveClick = () => {
                if (autoSaveState.value === 'disconnected') connectAutoSave();
                else if (autoSaveState.value === 'connected') disconnectAutoSave();
                else reconnectAutoSave();
            };
            // Adopt an existing backup file: load its tasks first, THEN keep
            // auto-saving to that same file. Distinct from connectAutoSave, which
            // writes the current list out immediately - picking an existing backup
            // there would overwrite it (with an empty list on first run). Here we
            // read before writing, so no data is lost.
            const openExistingBackup = async () => {
                if (!fileAccessSupported) return;
                try {
                    const [handle] = await window.showOpenFilePicker({
                        mode: 'readwrite',
                        types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }],
                        multiple: false,
                    });
                    const file = await handle.getFile();
                    const imported = JSON.parse(await file.text());
                    if (!Array.isArray(imported)) throw new Error('Backup JSON is not an array');
                    const mapped = imported.map(task => ({
                        subtasks: [], description: '', dueDate: null, dueTime: null, tags: [], snoozedUntil: null, ...task
                    }));
                    const previous = tasks.value;
                    // Connect the handle before assigning tasks, so the reactive
                    // write that follows lands in this file (a harmless re-save of
                    // the data we just read, which also confirms write access).
                    fileHandle = handle;
                    await setStoredHandle(handle);
                    autoSaveState.value = 'connected';
                    dismissAutoSaveBanner();
                    tasks.value = mapped;
                    const n = mapped.length;
                    showToast(`Loaded ${n} task${n === 1 ? '' : 's'} — auto-saving to "${handle.name}"`,
                        previous.length ? { actionLabel: 'Undo', onAction: () => { tasks.value = previous; } } : {});
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    showToast('Could not open that backup file — it may be invalid JSON.', { variant: 'error' });
                }
            };

            onMounted(async () => {
                loadTasks();
                applyTheme();
                nextTick(() => feather.replace());
                if (fileAccessSupported) {
                    try {
                        const storedHandle = await getStoredHandle();
                        if (storedHandle) {
                            fileHandle = storedHandle;
                            const permission = await storedHandle.queryPermission({ mode: 'readwrite' });
                            autoSaveState.value = permission === 'granted' ? 'connected' : 'reconnect-needed';
                        }
                    } catch (e) {
                        // Stored handle is no longer valid (e.g. file moved/deleted) - stay disconnected.
                    }
                }
                checkOverdueTasks();
                checkSnoozedTasks();
                overdueCheckInterval = setInterval(() => {
                    checkOverdueTasks();
                    checkSnoozedTasks();
                }, 15 * 60 * 1000);
            });
            onUnmounted(() => {
                if (overdueCheckInterval) clearInterval(overdueCheckInterval);
            });
            watch(tasks, (newTasks) => {
                saveTasks(newTasks);
                if (autoSaveState.value === 'connected') writeToFile(newTasks);
                checkOverdueTasks();
                checkSnoozedTasks();
                nextTick(() => feather.replace());
            }, { deep: true });
            // Filtering by search mounts/unmounts task-item rows (not just re-renders
            // ones already on screen), so newly-reappearing rows need their icons
            // processed too - the watcher above only fires when `tasks` itself changes.
            watch(searchQuery, () => {
                nextTick(() => feather.replace());
            });

            // Tag filtering is its own state, NOT the text search box. It used to
            // just set searchQuery = tag, which meant only one tag at a time (each
            // click overwrote the last), no way to see or clear the selection, and
            // no selected state. Now it's a Set of chosen tags, combined with AND
            // (a task must carry every selected tag) so multiple tags narrow the
            // list rather than replace each other.
            const activeTagFilters = ref(new Set());
            const toggleTagFilter = (tag) => {
                const next = new Set(activeTagFilters.value);
                if (next.has(tag)) next.delete(tag); else next.add(tag);
                activeTagFilters.value = next;
            };
            const clearTagFilters = () => { activeTagFilters.value = new Set(); };
            const handleFilterByTag = (tag) => toggleTagFilter(tag);
            const isFiltering = computed(() =>
                searchQuery.value.trim() !== '' || activeTagFilters.value.size > 0
            );

            const matchesFilters = (task) => {
                const q = searchQuery.value.trim().toLowerCase();
                const textOk = !q ||
                    task.text.toLowerCase().includes(q) ||
                    (task.description || '').toLowerCase().includes(q) ||
                    (task.tags || []).some(tag => tag.toLowerCase().includes(q));
                if (!textOk) return false;
                if (activeTagFilters.value.size === 0) return true;
                const taskTags = task.tags || [];
                return [...activeTagFilters.value].every(t => taskTags.includes(t));
            };

            // --- Tag overview ---
            // Tags were previously only reachable by spotting a chip on some task;
            // there was no way to see what existed, fix a typo, or retire one.
            const TAG_PANEL_KEY = 'tagPanelOpen';
            const isTagPanelOpen = ref(localStorage.getItem(TAG_PANEL_KEY) === '1');
            const toggleTagPanel = () => {
                isTagPanelOpen.value = !isTagPanelOpen.value;
                localStorage.setItem(TAG_PANEL_KEY, isTagPanelOpen.value ? '1' : '0');
            };
            const allTags = computed(() => {
                const counts = new Map();
                for (const task of tasks.value) {
                    for (const tag of task.tags || []) {
                        counts.set(tag, (counts.get(tag) || 0) + 1);
                    }
                }
                return [...counts.entries()]
                    .map(([name, count]) => ({ name, count }))
                    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
            });

            // Both mutations touch every task carrying the tag, so they snapshot the
            // affected tasks' tag arrays and restore them on undo.
            const snapshotTags = (predicate) => tasks.value
                .filter(predicate)
                .map(t => ({ id: t.id, tags: [...(t.tags || [])] }));
            const restoreTags = (snapshot) => {
                for (const { id, tags } of snapshot) {
                    const task = tasks.value.find(t => t.id === id);
                    if (task) task.tags = tags;
                }
            };

            const renameTag = (oldName, newNameRaw) => {
                const newName = (newNameRaw || '').trim();
                if (!newName || newName === oldName) return;
                const affected = (t) => (t.tags || []).includes(oldName);
                const snapshot = snapshotTags(affected);
                if (snapshot.length === 0) return;
                for (const task of tasks.value) {
                    if (!(task.tags || []).includes(oldName)) continue;
                    // Renaming onto an existing tag merges the two - dedupe rather
                    // than leaving the same tag twice on one task.
                    task.tags = [...new Set(task.tags.map(t => (t === oldName ? newName : t)))];
                }
                showToast(`Renamed "${oldName}" to "${newName}"`, {
                    actionLabel: 'Undo',
                    onAction: () => restoreTags(snapshot),
                });
            };

            // Inline rename state. Replaces window.prompt(), which Electron does
            // not implement - so in the packaged app the old rename button silently
            // did nothing. Only one tag is edited at a time, so a single pair of
            // refs at the root is enough.
            const renamingTag = ref(null);
            const renameText = ref('');
            const startRenameTag = (name) => {
                renamingTag.value = name;
                renameText.value = name;
            };
            const commitRenameTag = () => {
                if (renamingTag.value === null) return; // guard: blur fires after Enter too
                const from = renamingTag.value;
                renamingTag.value = null;
                renameTag(from, renameText.value);
            };
            const cancelRenameTag = () => { renamingTag.value = null; };

            // The filter bar (its removable chips carry an <i data-feather="x">) and
            // the tag panel's rename<->chip swap both insert fresh data-feather
            // placeholders on these state changes; without a replace pass they'd
            // render as empty <i> elements. Declared here, after all three refs
            // exist, to stay clear of the temporal dead zone.
            watch([activeTagFilters, renamingTag, allTags], () => {
                nextTick(() => feather.replace());
            });

            const deleteTag = (name) => {
                const affected = (t) => (t.tags || []).includes(name);
                const snapshot = snapshotTags(affected);
                if (snapshot.length === 0) return;
                for (const task of tasks.value) {
                    if (!(task.tags || []).includes(name)) continue;
                    task.tags = task.tags.filter(t => t !== name);
                }
                showToast(`Removed tag "${name}" from ${snapshot.length} task${snapshot.length > 1 ? 's' : ''}`, {
                    actionLabel: 'Undo',
                    onAction: () => restoreTags(snapshot),
                });
            };

            // Opt-in only, never automatic: manual order is the default so the list
            // stays where you put it. While this is on, drag-reordering is suspended
            // (see TaskList) - onOrderUpdate derives `order` from the displayed
            // index, so dragging under a forced sort would make items snap back.
            const OVERDUE_FIRST_KEY = 'overdueFirst';
            const overdueFirst = ref(localStorage.getItem(OVERDUE_FIRST_KEY) === '1');
            const toggleOverdueFirst = () => {
                overdueFirst.value = !overdueFirst.value;
                localStorage.setItem(OVERDUE_FIRST_KEY, overdueFirst.value ? '1' : '0');
            };

            const pendingTasks = computed(() => {
                const list = tasks.value.filter(t => !t.completed && !isTaskSnoozed(t) && matchesFilters(t));
                if (!overdueFirst.value) return list.sort((a, b) => a.order - b.order);
                // Overdue block first, each block still in manual order internally.
                return list.sort((a, b) =>
                    (Number(isTaskOverdue(b)) - Number(isTaskOverdue(a))) || (a.order - b.order)
                );
            });
            const overdueCount = computed(() => tasks.value.filter(isTaskOverdue).length);
            const completedTasks = computed(() => tasks.value.filter(t => t.completed && matchesFilters(t)));
            // Soonest-back-first: this list exists to answer "what's coming up",
            // not to be manually reordered, so it's never draggable.
            const snoozedTasks = computed(() =>
                tasks.value.filter(t => !t.completed && isTaskSnoozed(t) && matchesFilters(t))
                    .sort((a, b) => a.snoozedUntil.localeCompare(b.snoozedUntil))
            );
            // Collapsed by default (opposite of Completed) - the point of snoozing
            // is to get a task out of the way, so it shouldn't reappear expanded.
            const SNOOZED_SECTION_COLLAPSED_KEY = 'snoozedSectionCollapsed';
            const snoozedSectionCollapsed = ref(localStorage.getItem(SNOOZED_SECTION_COLLAPSED_KEY) !== '0');
            const toggleSnoozedSection = () => {
                snoozedSectionCollapsed.value = !snoozedSectionCollapsed.value;
                localStorage.setItem(SNOOZED_SECTION_COLLAPSED_KEY, snoozedSectionCollapsed.value ? '1' : '0');
            };

            // The slash-date shortcuts had no discoverable entry point anywhere in
            // the UI; the empty state is the natural place to teach them.
            const pendingEmptyMessage = computed(() => isFiltering.value
                ? 'No pending tasks match your filters.'
                : 'No pending tasks. Add one above — type /today, /tomorrow or /yesterday to insert a date.');
            const completedEmptyMessage = computed(() => isFiltering.value
                ? 'No completed tasks match your filters.'
                : 'No completed tasks yet.');

            const loadTasks = () => {
                const data = localStorage.getItem(STORAGE_KEY);
                if (data) {
                    try {
                        tasks.value = JSON.parse(data).map(task => ({
                            subtasks: [],
                            description: '',
                            dueDate: null,
                            dueTime: null,
                            tags: [],
                            snoozedUntil: null,
                            ...task
                        }));
                    } catch (e) {
                        tasks.value = [];
                    }
                } else {
                    tasks.value = [];
                }
            };
            const saveTasks = (data) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            // Expands a completed "/today"-style token the moment it's followed by a
            // space, so it turns into the written-out date while you keep typing -
            // addTask()'s own expansion covers the case where Enter/Add is pressed
            // right after the token with no trailing space yet.
            const handleNewTaskInput = (event) => {
                const value = event.target.value;
                const match = value.match(new RegExp(SLASH_DATE_PATTERN.source + '\\s$', 'i'));
                if (!match) return;
                const expanded = formatSlashDate(SLASH_DATE_OFFSETS[match[1].toLowerCase()]);
                newTaskText.value = value.slice(0, match.index) + expanded + ' ';
            };
            const addTask = () => {
                const text = expandSlashDateShortcuts(newTaskText.value).trim();
                if (!text) return;
                const minOrder = pendingTasks.value.reduce((min, t) => Math.min(min, t.order ?? 0), 0);
                tasks.value.push({
                    id: Date.now().toString(), text, completed: false, completionDate: null,
                    description: "", subtasks: [], isImportant: false, order: minOrder - 1, dueDate: null, dueTime: null, tags: [],
                    snoozedUntil: null,
                });
                newTaskText.value = "";
            };
            const updateTask = (updatedTask) => {
                const index = tasks.value.findIndex(t => t.id === updatedTask.id);
                if (index === -1) return;
                const existing = tasks.value[index];
                // Any due date/time edit gets a fresh chance to alert, even if the
                // task was already alerted about today - otherwise nudging an
                // overdue task's date to a different (still overdue) moment would
                // stay silently suppressed by the old bookkeeping.
                if (
                    ('dueDate' in updatedTask && updatedTask.dueDate !== existing.dueDate) ||
                    ('dueTime' in updatedTask && updatedTask.dueTime !== existing.dueTime)
                ) {
                    const pruned = { ...notifiedOverdueTasks.value };
                    delete pruned[updatedTask.id];
                    notifiedOverdueTasks.value = pruned;
                }
                tasks.value[index] = { ...existing, ...updatedTask };
            };

            // --- Note editor overlay ---
            // A single root-level modal edits the note for whichever task/subtask
            // asked to open it (via the provided noteApi). Long notes get room the
            // inline textarea couldn't give; one editor serves both kinds.
            const noteEditor = ref(null);   // { kind:'task'|'subtask', taskId, subtaskId?, title }
            const noteDraft = ref('');
            // Read-first: the overlay opens showing the rendered note (you mostly
            // read notes), and Edit drops into the textarea. noteEditing=false means
            // the formatted read view.
            const noteEditing = ref(false);
            const notePreviewHtml = computed(() => renderNote(noteDraft.value));
            const startEditingNote = () => { noteEditing.value = true; nextTick(() => feather.replace()); };
            const finishEditingNote = () => { commitNote(); noteEditing.value = false; nextTick(() => feather.replace()); };
            let noteReturnFocus = null;
            let noteSaveTimer = null;

            const currentNoteText = () => {
                if (!noteEditor.value) return '';
                const task = tasks.value.find(t => t.id === noteEditor.value.taskId);
                if (!task) return '';
                if (noteEditor.value.kind === 'task') return task.description || '';
                const st = (task.subtasks || []).find(s => s.id === noteEditor.value.subtaskId);
                return (st && st.note) || '';
            };
            const commitNote = () => {
                if (!noteEditor.value) return;
                const { kind, taskId, subtaskId } = noteEditor.value;
                const task = tasks.value.find(t => t.id === taskId);
                if (!task) return;
                if (kind === 'task') {
                    if ((task.description || '') !== noteDraft.value) updateTask({ id: taskId, description: noteDraft.value });
                } else {
                    const subtasks = (task.subtasks || []).map(s =>
                        s.id === subtaskId ? { ...s, note: noteDraft.value } : s);
                    updateTask({ id: taskId, subtasks });
                }
            };
            const onNoteInput = () => {
                // Debounced autosave: commit ~0.5s after typing stops rather than on
                // every keystroke (each commit runs the deep tasks watcher).
                clearTimeout(noteSaveTimer);
                noteSaveTimer = setTimeout(commitNote, 500);
            };
            // Keep focus within the modal (best-practice focus trap) and close on Esc.
            const onNoteKeydown = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); closeNoteEditor(); return; }
                if (e.key !== 'Tab') return;
                const modal = document.querySelector('.note-modal');
                if (!modal) return;
                const f = [...modal.querySelectorAll('button, textarea, [href], input, [tabindex]:not([tabindex="-1"])')]
                    .filter(el => !el.disabled && el.offsetParent !== null);
                if (f.length === 0) return;
                const first = f[0], last = f[f.length - 1];
                if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
            };
            const openNoteEditor = (target) => {
                noteReturnFocus = document.activeElement;
                noteEditor.value = target;
                noteDraft.value = currentNoteText();
                // Empty notes have nothing to read, so open straight in edit mode.
                noteEditing.value = currentNoteText() === '';
                document.body.classList.add('modal-open');
                document.addEventListener('keydown', onNoteKeydown);
                nextTick(() => feather.replace());
            };
            const closeNoteEditor = () => {
                clearTimeout(noteSaveTimer);
                commitNote();
                noteEditor.value = null;
                document.body.classList.remove('modal-open');
                document.removeEventListener('keydown', onNoteKeydown);
                // Restore focus to whatever opened the editor (keyboard users).
                if (noteReturnFocus && noteReturnFocus.focus) noteReturnFocus.focus();
                noteReturnFocus = null;
            };
            provide('noteApi', { open: openNoteEditor });

            // --- Activity log: what got completed on a given day, across BOTH
            // whole tasks and individual subtasks. A subtask's own completionDate
            // already exists (from the earlier per-subtask completion-date work)
            // independent of whether its parent task is done - that's what makes
            // this possible without any new data model. Purely a lookup view:
            // nothing here is persisted beyond what tasks/subtasks already carry.
            const isActivityOpen = ref(false);
            const activityDate = ref(toLocalDateKey(new Date()));
            let activityReturnFocus = null;

            function addDaysToDateKey(dateKey, n) {
                const d = new Date(dateKey + 'T00:00:00');
                d.setDate(d.getDate() + n);
                return toLocalDateKey(d);
            }

            const activityItems = computed(() => {
                const dateKey = activityDate.value;
                const items = [];
                for (const task of tasks.value) {
                    if (task.completed && task.completionDate && toLocalDateKey(task.completionDate) === dateKey) {
                        items.push({ kind: 'task', id: task.id, text: task.text, at: task.completionDate });
                    }
                    for (const st of (task.subtasks || [])) {
                        if (st.completed && st.completionDate && toLocalDateKey(st.completionDate) === dateKey) {
                            items.push({ kind: 'subtask', id: st.id, text: st.text, parentText: task.text, at: st.completionDate });
                        }
                    }
                }
                // Ascending, so the list reads as a timeline of the day.
                return items.sort((a, b) => new Date(a.at) - new Date(b.at));
            });

            const activityDateLabel = computed(() => {
                const date = new Date(activityDate.value + 'T00:00:00');
                const today = new Date();
                const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
                const weekday = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                if (date.toDateString() === today.toDateString()) return `Today · ${weekday}`;
                if (date.toDateString() === yesterday.toDateString()) return `Yesterday · ${weekday}`;
                return weekday;
            });

            const onActivityKeydown = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); closeActivityLog(); }
            };
            // Defaults to yesterday every time it's opened - that's the stated
            // main use case (status updates for what you did), not "today so far".
            const openActivityLog = () => {
                activityReturnFocus = document.activeElement;
                const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
                activityDate.value = toLocalDateKey(yesterday);
                isActivityOpen.value = true;
                document.body.classList.add('modal-open');
                document.addEventListener('keydown', onActivityKeydown);
            };
            const closeActivityLog = () => {
                isActivityOpen.value = false;
                document.body.classList.remove('modal-open');
                document.removeEventListener('keydown', onActivityKeydown);
                if (activityReturnFocus && activityReturnFocus.focus) activityReturnFocus.focus();
                activityReturnFocus = null;
            };
            const shiftActivityDate = (n) => { activityDate.value = addDaysToDateKey(activityDate.value, n); };
            const setActivityToday = () => { activityDate.value = toLocalDateKey(new Date()); };
            const setActivityDate = (value) => { if (value) activityDate.value = value; };

            // Plain-text bullet list, ready to paste into a standup/Slack update -
            // the one part of this feature that actually serves "give my team an
            // update" rather than just being a nicer screen to look at.
            const copyActivitySummary = async () => {
                const lines = activityItems.value.map(item =>
                    item.kind === 'task' ? `- ${item.text}` : `- ${item.text} (part of: ${item.parentText})`
                );
                const header = `What I did — ${activityDateLabel.value}`;
                const text = lines.length ? `${header}\n${lines.join('\n')}` : `${header}\nNothing completed.`;
                try {
                    await navigator.clipboard.writeText(text);
                    showToast('Copied to clipboard');
                } catch (e) {
                    showToast('Could not copy to clipboard.', { variant: 'error' });
                }
            };

            // New <i data-feather> icons appear whenever the modal opens or the
            // viewed date changes (a fresh v-for of activity-item icons) - feather
            // only scans the DOM on an explicit .replace() call, so without this
            // they'd render as bare, un-swapped <i> tags (same class of bug as the
            // due-badge icon fix elsewhere in this file).
            watch([isActivityOpen, activityItems], () => {
                if (isActivityOpen.value) nextTick(() => feather.replace());
            });

            const deleteTask = (taskId) => {
                const removed = tasks.value.find(t => t.id === taskId);
                if (!removed) return;
                tasks.value = tasks.value.filter(t => t.id !== taskId);
                showToast(`Deleted "${removed.text}"`, {
                    actionLabel: 'Undo',
                    onAction: () => { tasks.value.push(removed); },
                });
            };
            const deleteMany = (taskIds) => {
                const idSet = new Set(taskIds);
                const removed = tasks.value.filter(t => idSet.has(t.id));
                if (removed.length === 0) return;
                tasks.value = tasks.value.filter(t => !idSet.has(t.id));
                showToast(`Deleted ${removed.length} task${removed.length > 1 ? 's' : ''}`, {
                    actionLabel: 'Undo',
                    onAction: () => { tasks.value.push(...removed); },
                });
            };
            const clearCompleted = () => {
                const removed = tasks.value.filter(t => t.completed);
                if (removed.length === 0) return;
                tasks.value = tasks.value.filter(t => !t.completed);
                showToast(`Cleared ${removed.length} completed task${removed.length > 1 ? 's' : ''}`, {
                    actionLabel: 'Undo',
                    onAction: () => { tasks.value.push(...removed); },
                });
            };
            const onOrderUpdate = (reorderedPendingTasks) => {
                reorderedPendingTasks.forEach((task, index) => {
                    const taskInState = tasks.value.find(t => t.id === task.id);
                    if (taskInState) taskInState.order = index;
                });
            };
            const handleExport = () => {
                const dataStr = JSON.stringify(tasks.value, null, 2);
                const link = document.createElement('a');
                link.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
                link.download = 'tasks.json';
                link.click();
            };
            const triggerImport = () => document.getElementById('import-input').click();
            const handleImport = (event) => {
                const file = event.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = e => {
                    try {
                        const imported = JSON.parse(e.target.result);
                        if (!Array.isArray(imported)) throw new Error('Imported JSON is not an array');
                        const previous = tasks.value;
                        tasks.value = imported.map(task => ({ subtasks: [], description: '', dueDate: null, dueTime: null, tags: [], snoozedUntil: null, ...task }));
                        showToast(`Imported ${tasks.value.length} task${tasks.value.length === 1 ? '' : 's'} (replaced ${previous.length})`, {
                            actionLabel: 'Undo',
                            onAction: () => { tasks.value = previous; },
                        });
                    } catch (err) {
                        showToast('Could not import tasks — the file appears to be invalid.', { variant: 'error' });
                    }
                };
                reader.readAsText(file);
                event.target.value = '';
            };

            return {
                tasks, newTaskText, searchQuery, theme, toggleTheme, toast, dismissToast, handleToastAction,
                pendingTasks, completedTasks, pendingEmptyMessage, completedEmptyMessage,
                addTask, handleNewTaskInput, updateTask, deleteTask, deleteMany, clearCompleted, onOrderUpdate, handleFilterByTag,
                expandedTaskIds, setTaskExpanded,
                handleExport, triggerImport, handleImport,
                fileAccessSupported, autoSaveState, autoSaveLabel, handleAutoSaveClick, openExistingBackup,
                showAutoSaveBanner, showAutoSaveFooterButton, dismissAutoSaveBanner,
                overdueAlert, dismissOverdueAlert,
                showNotifyBanner, enableOverdueNotifications, dismissNotifyBanner,
                completedSectionCollapsed, toggleCompletedSection,
                snoozedTasks, snoozedSectionCollapsed, toggleSnoozedSection,
                overdueFirst, toggleOverdueFirst, overdueCount,
                isTagPanelOpen, toggleTagPanel, allTags, deleteTag,
                activeTagFilters, toggleTagFilter, clearTagFilters,
                renamingTag, renameText, startRenameTag, commitRenameTag, cancelRenameTag,
                noteEditor, noteDraft, noteEditing, notePreviewHtml, onNoteInput, closeNoteEditor,
                startEditingNote, finishEditingNote,
                isActivityOpen, activityDate, activityItems, activityDateLabel,
                openActivityLog, closeActivityLog, shiftActivityDate, setActivityToday, setActivityDate,
                copyActivitySummary
            };
        }
    })
    // Focus a freshly-shown element (the inline tag-rename input) - Vue 3 has no
    // built-in equivalent of the old autofocus-on-mount behaviour for v-if content.
    .directive('focus', { mounted: (el) => el.focus() })
    .component('task-list', TaskList)
    .component('completed-tasks', CompletedTasks)
    .component('snoozed-tasks', SnoozedTasks)
    .mount('#app');
});
