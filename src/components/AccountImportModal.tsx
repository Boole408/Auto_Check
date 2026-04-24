import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { motion } from "framer-motion";
import { FileUp, LoaderCircle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { importAccounts } from "@/services/api";
import type { ImportAccountsResult } from "@/types";

const ACCOUNT_IMPORT_PLACEHOLDER = `支持 txt:
username,password
账号：your_username，密码：your_password

支持 json:
[
  { "username": "user1", "password": "pass1" },
  { "username": "user2", "password": "pass2" }
]`;

interface AccountImportModalProps {
  isOpen: boolean;
  accountFile?: string | null;
  onClose: () => void;
  onSuccess: (result: ImportAccountsResult) => void | Promise<void>;
  onNotice?: (message: string) => void;
}

export function AccountImportModal({
  isOpen,
  accountFile,
  onClose,
  onSuccess,
  onNotice
}: AccountImportModalProps) {
  const [accountImportDraft, setAccountImportDraft] = useState("");
  const [accountImportFileName, setAccountImportFileName] = useState("");
  const [importingAccounts, setImportingAccounts] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    document.body.classList.add("overflow-hidden");
    return () => document.body.classList.remove("overflow-hidden");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [isOpen, onClose]);

  async function handleImportFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!/\.(txt|json)$/i.test(file.name)) {
      onNotice?.("仅支持导入 txt 或 json 文件");
      event.target.value = "";
      return;
    }

    const content = await file.text();
    setAccountImportDraft(content);
    setAccountImportFileName(file.name);
    onNotice?.(`已载入 ${file.name}，确认后点击保存账号`);
    event.target.value = "";
  }

  async function handleImportAccounts() {
    if (!accountImportDraft.trim()) {
      onNotice?.("请先粘贴账号内容或选择 txt/json 文件");
      return;
    }

    try {
      setImportingAccounts(true);
      const result = await importAccounts({
        content: accountImportDraft,
        format: "auto"
      });

      setAccountImportDraft("");
      setAccountImportFileName("");
      onClose();
      await onSuccess(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "账号导入失败，请检查内容格式";
      onNotice?.(message);
    } finally {
      setImportingAccounts(false);
    }
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(16,42,36,0.18)] px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="w-full max-w-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <Card className="max-h-[88vh] overflow-hidden">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>账号导入</CardTitle>
                <CardDescription>
                  支持直接粘贴账号密码，或导入 `txt/json` 文件，保存后立即刷新看板。
                </CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 overflow-y-auto pb-6">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.json,application/json,text/plain"
              className="hidden"
              onChange={(event) => void handleImportFileChange(event)}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="h-4 w-4" />
                选择 txt/json
              </Button>
              <Badge variant="outline" className="max-w-full truncate">
                {accountImportFileName || "未选择文件，可直接粘贴内容"}
              </Badge>
              {(accountImportDraft || accountImportFileName) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAccountImportDraft("");
                    setAccountImportFileName("");
                  }}
                >
                  清空
                </Button>
              ) : null}
            </div>

            <textarea
              value={accountImportDraft}
              onChange={(event) => setAccountImportDraft(event.target.value)}
              rows={10}
              placeholder={ACCOUNT_IMPORT_PLACEHOLDER}
              className="min-h-[260px] w-full rounded-2xl border border-[#DDEAE5] bg-[rgba(255,255,255,0.84)] px-4 py-3 text-sm text-[#2F4A43] outline-none transition placeholder:text-[#9AABA5] focus:border-[#34C79A] focus:ring-2 focus:ring-[#34C79A]/15 dark:border-[#294038] dark:bg-[rgba(19,31,27,0.92)] dark:text-[#D8EEE6] dark:placeholder:text-[#7F9990]"
            />

            <div className="flex flex-col gap-3 text-xs text-muted-foreground">
              <span>当前保存路径：{accountFile || "./accounts.txt"}</span>
              <span>支持格式：`username,password`、`账号：xxx，密码：yyy`、JSON 数组对象。</span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                保存时会覆盖当前账号文件，请确认内容无误。
              </span>
              <Button
                onClick={() => void handleImportAccounts()}
                disabled={importingAccounts || !accountImportDraft.trim()}
              >
                {importingAccounts ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <FileUp className="h-4 w-4" />
                )}
                保存账号
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
