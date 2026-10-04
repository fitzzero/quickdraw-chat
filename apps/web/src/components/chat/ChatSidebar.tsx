"use client";

import * as React from "react";
import {
  Box,
  Typography,
  TextField,
  Button,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  IconButton,
  Chip,
  Divider,
  Skeleton,
  InputAdornment,
  CircularProgress,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import DeleteIcon from "@mui/icons-material/Delete";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { UserAvatar } from "../user";
import { ConfirmDialog } from "../feedback";
import { qd, useQuickdraw } from "../../lib/quickdraw";
import { useErrorText } from "../../hooks/useErrorText";
import type { ChatDTO, ChatMemberDTO, AccessLevel } from "@project/shared";

interface ChatSidebarProps {
  chatId: string;
}

// Helper to compare access levels
const ACCESS_LEVELS: AccessLevel[] = ["Public", "Read", "Moderate", "Admin"];
function isLevelSufficient(
  userLevel: AccessLevel | undefined,
  requiredLevel: AccessLevel,
): boolean {
  if (!userLevel) return false;
  return ACCESS_LEVELS.indexOf(userLevel) >= ACCESS_LEVELS.indexOf(requiredLevel);
}

/**
 * Resolve the user's effective access level for the chat from their
 * service-wide level and their per-chat membership level.
 */
function resolveEffectiveLevel(
  serviceLevel: AccessLevel | undefined,
  entryLevel: AccessLevel | undefined,
): AccessLevel | undefined {
  if (!serviceLevel) return entryLevel;
  return isLevelSufficient(serviceLevel, entryLevel ?? "Public") ? serviceLevel : entryLevel;
}

function getRoleBadge(level: string): {
  label: string;
  color: "default" | "primary" | "secondary";
} {
  switch (level) {
    case "Admin":
      return { label: "Admin", color: "secondary" };
    case "Moderate":
      return { label: "Mod", color: "primary" };
    default:
      return { label: "Member", color: "default" };
  }
}

interface ChatTitleSectionProps {
  chat: ChatDTO | undefined;
  canModerate: boolean;
  /** Renames the chat: shown at once, dropped again if the server refuses. */
  onRename: (title: string) => void;
  /** Why the last rename was refused, if it was. */
  renameError: string | null;
}

function ChatTitleSection({
  chat,
  canModerate,
  onRename,
  renameError,
}: ChatTitleSectionProps): React.ReactElement {
  const t = useTranslations("ChatWindow");
  // The title being edited; null while not editing
  const [draft, setDraft] = React.useState<string | null>(null);

  // Commits on blur or Enter, as 4.x's SocketTextField did with commitMode="blur"
  const commit = (): void => {
    if (draft === null) return;
    const title = draft.trim();
    setDraft(null);
    if (chat && title.length > 0 && title !== chat.title) {
      onRename(title);
    }
  };

  return (
    <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
      {draft !== null && chat ? (
        <TextField
          fullWidth
          size="small"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setDraft(null);
          }}
          autoFocus
          slotProps={{ htmlInput: { maxLength: 100, "aria-label": t("chatTitleLabel") } }}
        />
      ) : (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            "&:hover .edit-icon": canModerate ? { opacity: 1 } : {},
          }}
        >
          <Typography variant="h6" sx={{ flex: 1 }}>
            {chat?.title ?? <Skeleton width="60%" />}
          </Typography>
          {canModerate && (
            <IconButton
              className="edit-icon"
              size="small"
              onClick={() => {
                setDraft(chat?.title ?? "");
              }}
              aria-label={t("chatTitleLabel")}
              sx={{ opacity: 0, transition: "opacity 0.2s" }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      )}
      {renameError !== null && (
        <Typography variant="caption" color="error" sx={{ display: "block", mt: 0.5 }}>
          {renameError}
        </Typography>
      )}
    </Box>
  );
}

interface InviteSectionProps {
  chatId: string;
}

function InviteSection({ chatId }: InviteSectionProps): React.ReactElement {
  const t = useTranslations("ChatSidebar");
  const errorText = useErrorText();
  const [inviteUsername, setInviteUsername] = React.useState("");
  const [inviteError, setInviteError] = React.useState<string | null>(null);

  // The new member shows in the roster through the memberUpdate event, and the
  // chat in their list through myChats. An invite above the inviter's own
  // level is FORBIDDEN (this form invites at Read).
  const inviteByName = qd.chatService.inviteByName.useMutation({
    onSuccess: (result) => {
      if ("error" in result) {
        setInviteError(t("inviteUserNotFound"));
      } else {
        setInviteUsername("");
        setInviteError(null);
      }
    },
    onError: (error) => {
      setInviteError(errorText(error));
    },
  });

  const handleInvite = (): void => {
    if (!inviteUsername.trim()) return;
    setInviteError(null);
    inviteByName.mutate({
      chatId,
      userName: inviteUsername.trim(),
      level: "Read",
    });
  };

  return (
    <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        {t("inviteTitle")}
      </Typography>
      <TextField
        size="small"
        fullWidth
        placeholder={t("invitePlaceholder")}
        value={inviteUsername}
        onChange={(e) => {
          setInviteUsername(e.target.value);
          setInviteError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleInvite();
        }}
        error={!!inviteError}
        helperText={inviteError}
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  onClick={handleInvite}
                  disabled={!inviteUsername.trim() || inviteByName.isPending}
                  edge="end"
                  size="small"
                >
                  {inviteByName.isPending ? <CircularProgress size={20} /> : <PersonAddIcon />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
    </Box>
  );
}

interface MembersSectionProps {
  members: ChatMemberDTO[];
  isLoading: boolean;
  canRemoveMember: (member: ChatMemberDTO) => boolean;
  onRemoveMember: (member: ChatMemberDTO) => void;
}

function MembersSection({
  members,
  isLoading,
  canRemoveMember,
  onRemoveMember,
}: MembersSectionProps): React.ReactElement {
  const t = useTranslations("ChatSidebar");
  const tCommon = useTranslations("Common");

  return (
    <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        {t("membersTitle")}
      </Typography>
      {isLoading ? (
        <List dense disablePadding>
          {[1, 2, 3].map((i) => (
            <ListItem key={i} disablePadding sx={{ py: 0.5 }}>
              <ListItemAvatar sx={{ minWidth: 40 }}>
                <Skeleton variant="circular" width={32} height={32} />
              </ListItemAvatar>
              <ListItemText primary={<Skeleton width="60%" />} />
            </ListItem>
          ))}
        </List>
      ) : (
        <List dense disablePadding>
          {members.map((member) => {
            const badge = getRoleBadge(member.level);
            return (
              <ListItem
                key={member.id}
                disablePadding
                sx={{ py: 0.5 }}
                secondaryAction={
                  canRemoveMember(member) ? (
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={() => {
                        onRemoveMember(member);
                      }}
                      sx={{ opacity: 0.5, "&:hover": { opacity: 1 } }}
                    >
                      <RemoveCircleOutlineIcon fontSize="small" />
                    </IconButton>
                  ) : null
                }
              >
                <ListItemAvatar sx={{ minWidth: 40 }}>
                  <UserAvatar userId={member.userId} size={32} />
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2" noWrap>
                        {member.user.name ?? tCommon("unknownUser")}
                      </Typography>
                      <Chip
                        label={badge.label}
                        color={badge.color}
                        size="small"
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                    </Box>
                  }
                />
              </ListItem>
            );
          })}
        </List>
      )}
    </Box>
  );
}

export function ChatSidebar({ chatId }: ChatSidebarProps): React.ReactElement {
  const t = useTranslations("ChatSidebar");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const errorText = useErrorText();
  const { userId, serviceAccess } = useQuickdraw();

  // The chat, live (its title)
  const { data: chat } = qd.chatService.useEntity(chatId);

  // Members roster: a query-shaped read (memberships joined to profiles).
  // The server sends memberUpdate to each member's sockets whenever the
  // chat's members change (an invite, a removal, a leave), so the roster is
  // read again then: 4.x's invalidateOn, as an event handler.
  const { data: queryMembers, isLoading: membersLoading } = qd.chatService.getChatMembers.useQuery(
    { chatId },
    { enabled: !!chatId },
  );
  // quickdraw-5.0 finding: the event carries the new roster, but the typed client has no way to put it into the query's cache (no setData beside invalidate), so the app reads it again (or would copy it into React state)
  qd.chatService.memberUpdate.useEvent((update) => {
    if (update.chatId === chatId) {
      qd.invalidate(qd.chatService.getChatMembers, { chatId });
    }
  });
  const members = React.useMemo(() => queryMembers ?? [], [queryMembers]);

  // UI state
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [removeMemberDialogOpen, setRemoveMemberDialogOpen] = React.useState(false);
  const [memberToRemove, setMemberToRemove] = React.useState<ChatMemberDTO | null>(null);

  // Service methods (mutations only). A rename is optimistic: the new title
  // shows at once here, in the page title and in every list holding the chat
  // (myChats items), is dropped if the server refuses it, and gives way to
  // the server's row. (The default for a mutation with `id` and an "entity"
  // output, written out.)
  const updateTitle = qd.chatService.updateTitle.useMutation({
    optimistic: (input, cache) => {
      cache.patchEntity(input.id, { title: input.title });
    },
  });
  const removeUser = qd.chatService.removeUser.useMutation();
  const deleteChat = qd.chatService.deleteChat.useMutation({
    onSuccess: () => {
      router.push("/chats");
    },
  });

  // Get current user's membership level
  const currentUserMember = React.useMemo(
    () => members.find((m) => m.userId === userId),
    [members, userId],
  );

  // Check permissions
  const serviceLevel: AccessLevel | undefined = serviceAccess?.chatService;
  const effectiveLevel = resolveEffectiveLevel(serviceLevel, currentUserMember?.level);

  const canModerate = isLevelSufficient(effectiveLevel, "Moderate");
  const canAdmin = isLevelSufficient(effectiveLevel, "Admin");

  // Handle title update
  const { mutate: rename } = updateTitle;
  const handleRename = React.useCallback(
    (title: string): void => {
      rename({ id: chatId, title });
    },
    [rename, chatId],
  );
  const renameError =
    updateTitle.error === null ? null : t("renameFailed", { reason: errorText(updateTitle.error) });

  // Handle remove member
  const handleRemoveMember = React.useCallback((member: ChatMemberDTO): void => {
    setMemberToRemove(member);
    setRemoveMemberDialogOpen(true);
  }, []);

  const confirmRemoveMember = (): void => {
    if (!memberToRemove) return;
    removeUser.mutate(
      { id: chatId, userId: memberToRemove.userId },
      {
        onSettled: () => {
          setRemoveMemberDialogOpen(false);
          setMemberToRemove(null);
        },
      },
    );
  };

  // Handle delete chat
  const handleDeleteChat = (): void => {
    deleteChat.mutate(
      { id: chatId },
      {
        onError: () => {
          setDeleteDialogOpen(false);
        },
      },
    );
  };

  // A refused removal or deletion (FORBIDDEN, say), said once under the roster
  const actionError = removeUser.error ?? deleteChat.error;

  // Can remove this member? Must be Moderate+ and target must be lower level than current user
  const canRemoveMember = React.useCallback(
    (member: ChatMemberDTO): boolean => {
      if (!canModerate) return false;
      // Can't remove self
      if (member.userId === userId) return false;
      return !isLevelSufficient(member.level, effectiveLevel ?? "Public");
    },
    [canModerate, userId, effectiveLevel],
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Chat Title Section */}
      <ChatTitleSection
        chat={chat}
        canModerate={canModerate}
        onRename={handleRename}
        renameError={renameError}
      />

      {/* Invite Section */}
      {canModerate && <InviteSection chatId={chatId} />}

      {/* Members List */}
      <MembersSection
        members={members}
        isLoading={membersLoading}
        canRemoveMember={canRemoveMember}
        onRemoveMember={handleRemoveMember}
      />

      {actionError !== null && (
        <Typography variant="caption" color="error" sx={{ px: 2, pb: 1 }}>
          {errorText(actionError)}
        </Typography>
      )}

      {/* Delete Section */}
      {canAdmin && (
        <>
          <Divider />
          <Box sx={{ p: 2 }}>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              fullWidth
              onClick={() => {
                setDeleteDialogOpen(true);
              }}
            >
              {t("deleteChatButton")}
            </Button>
          </Box>
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={() => {
          setDeleteDialogOpen(false);
        }}
        onConfirm={handleDeleteChat}
        title={t("deleteChatConfirmTitle")}
        message={t("deleteChatConfirmMessage")}
        confirmLabel={tCommon("delete")}
        destructive
        isLoading={deleteChat.isPending}
      />

      {/* Remove Member Confirmation Dialog */}
      <ConfirmDialog
        open={removeMemberDialogOpen}
        onClose={() => {
          setRemoveMemberDialogOpen(false);
          setMemberToRemove(null);
        }}
        onConfirm={confirmRemoveMember}
        title={t("removeMemberConfirmTitle")}
        message={t("removeMemberConfirmMessage", {
          name: memberToRemove?.user.name ?? tCommon("unknownUser"),
        })}
        confirmLabel={tCommon("confirm")}
        destructive
        isLoading={removeUser.isPending}
      />
    </Box>
  );
}
