import Meta from 'gi://Meta';
import St from 'gi://St';
import Gio from 'gi://Gio';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

export default class JbrClipboardFixExtension extends Extension {
    enable() {
        this._selection = global.display.get_selection();
        this._clipboard = St.Clipboard.get_default();
        this._isRewriting = false;
        this._timeoutIds = new Set();

        this._ownerChangedId = this._selection.connect('owner-changed', (selection, selectionType) => {
            if (selectionType !== Meta.SelectionType.SELECTION_CLIPBOARD) return;
            if (this._isRewriting) return;

            // 稍微延迟 20ms，等待数据源在 Wayland 合成器中就绪
            const debounceId = setTimeout(() => {
                this._timeoutIds.delete(debounceId);
                if (this._isRewriting) return;

                const outputStream = Gio.MemoryOutputStream.new_resizable();
                const cancellable = new Gio.Cancellable();

                this._selection.transfer_async(
                    Meta.SelectionType.SELECTION_CLIPBOARD,
                    'text/plain;charset=utf-8',
                    -1,
                    outputStream,
                    cancellable,
                    (obj, res) => {
                        try {
                            const success = this._selection.transfer_finish(res);
                            if (!success) return;

                            outputStream.close(null);
                            const bytes = outputStream.steal_as_bytes();
                            const dataArray = bytes.toArray();
                            if (dataArray.length === 0) return;

                            const decoder = new TextDecoder('utf-8');
                            const text = decoder.decode(dataArray);

                            // 仅当包含多字节字符（如中文）时进行标准 UTF-8 重写
                            if (text && /[\u0080-\uffff]/.test(text)) {
                                this._isRewriting = true;
                                this._clipboard.set_text(St.ClipboardType.CLIPBOARD, text);

                                const resetId = setTimeout(() => {
                                    this._timeoutIds.delete(resetId);
                                    this._isRewriting = false;
                                }, 300);
                                this._timeoutIds.add(resetId);
                            }
                        } catch (err) {
                            this._isRewriting = false;
                        }
                    }
                );
            }, 20);
            this._timeoutIds.add(debounceId);
        });
    }

    disable() {
        if (this._ownerChangedId) {
            this._selection.disconnect(this._ownerChangedId);
            this._ownerChangedId = null;
        }

        if (this._timeoutIds) {
            for (const id of this._timeoutIds) {
                clearTimeout(id);
            }
            this._timeoutIds.clear();
            this._timeoutIds = null;
        }

        this._selection = null;
        this._clipboard = null;
    }
}