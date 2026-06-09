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
import { SocketTextField } from "@fitzzero/quickdraw-core/client";
import { useSocket } from "../../providers";
import { useRoomEvents, useService, useServiceQuery, useSubscription } from "../../hooks";
import { UserAvatar } from "../user";
import { ConfirmDialog } from "../feedback";
import type { ChatMemberDTO, AccessLevel, SubscriptionDataMap } from "@project/shared";

type ChatEntity = SubscriptionDataMap["chatService"];

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
  chat: ChatEntity | null;
  canModerate: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onTitleUpdate: (patch: { title?: string }) => Promise<unknown>;
}

function ChatTitleSection({
  chat,
  canModerate,
  isEditing,
  onStartEdit,
  onStopEdit,
  onTitleUpdate,
}: ChatTitleSectionProps): React.ReactElement {
  return (
    <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
      {isEditing && chat ? (
        <SocketTextField
          state={chat}
          update={onTitleUpdate}
          property="title"
          commitMode="blur"
          onSuccess={onStopEdit}
          autoFocus
          style={{
            width: "100%",
            padding: "8px 12px",
            fontSize: "1.25rem",
            fontWeight: 500,
            border: "1px solid",
            borderColor: "rgba(255, 255, 255, 0.23)",
            borderRadius: "4px",
            backgroundColor: "transparent",
            color: "inherit",
          }}
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
              onClick={onStartEdit}
              sx={{ opacity: 0, transition: "opacity 0.2s" }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          )}
        </Box>
      )}
    </Box>
  );
}

interface InviteSectionProps {
  chatId: string;
}

function InviteSection({ chatId }: InviteSectionProps): React.ReactElement {
  const t = useTranslations("ChatSidebar");
  const [inviteUsername, setInviteUsername] = React.useState("");
  const [inviteError, setInviteError] = React.useState<string | null>(null);

  const inviteByName = useService("chatService", "inviteByName", {
    onSuccess: (result) => {
      if ("error" in result) {
        setInviteError(t("inviteUserNotFound"));
      } else {
        setInviteUsername("");
        setInviteError(null);
      }
    },
    onError: (error) => {
      setInviteError(error);
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
  const { userId, serviceAccess } = useSocket();

  // Chat subscription for title (also keeps the socket in the chat room)
  const { data: chat } = useSubscription("chatService", chatId);

  // Fetch members with useServiceQuery
  const { data: queryMembers, isLoading: membersLoading } = useServiceQuery(
    "chatService",
    "getChatMembers",
    { chatId },
    { enabled: !!chatId },
  );

  // Local members state (synced from query and socket updates)
  const [members, setMembers] = React.useState<ChatMemberDTO[]>([]);

  // Sync query data to local state
  React.useEffect(() => {
    if (queryMembers) {
      setMembers(queryMembers);
    }
  }, [queryMembers]);

  // UI state
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [removeMemberDialogOpen, setRemoveMemberDialogOpen] = React.useState(false);
  const [memberToRemove, setMemberToRemove] = React.useState<ChatMemberDTO | null>(null);

  // Service methods (mutations only)
  const updateTitle = useService("chatService", "updateTitle");
  const removeUser = useService("chatService", "removeUser");
  const deleteChat = useService("chatService", "deleteChat", {
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
  const serviceLevel = serviceAccess?.chatService as AccessLevel | undefined;
  const effectiveLevel = resolveEffectiveLevel(serviceLevel, currentUserMember?.level);

  const canModerate = isLevelSufficient(effectiveLevel, "Moderate");
  const canAdmin = isLevelSufficient(effectiveLevel, "Admin");

  // Listen for member updates broadcast to the chat room.
  // Room membership is managed by the useSubscription call above;
  // useRoomEvents only attaches/detaches the listener.
  useRoomEvents({
    "chat:memberUpdate": (update: { members?: ChatMemberDTO[] }) => {
      if (update.members) {
        setMembers(update.members);
      }
    },
  });

  // Handle title update
  const handleTitleUpdate = React.useCallback(
    async (patch: { title?: string }) => {
      if (!chat || !patch.title) return null;
      const result = await updateTitle.mutateAsync({ id: chatId, title: patch.title });
      setIsEditingTitle(false);
      return result;
    },
    [chat, chatId, updateTitle],
  );

  // Handle remove member
  const handleRemoveMember = React.useCallback((member: ChatMemberDTO): void => {
    setMemberToRemove(member);
    setRemoveMemberDialogOpen(true);
  }, []);

  const confirmRemoveMember = async (): Promise<void> => {
    if (!memberToRemove) return;
    await removeUser.mutateAsync({ id: chatId, userId: memberToRemove.userId });
    setRemoveMemberDialogOpen(false);
    setMemberToRemove(null);
  };

  // Handle delete chat
  const handleDeleteChat = async (): Promise<void> => {
    await deleteChat.mutateAsync({ id: chatId });
  };

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
        isEditing={isEditingTitle}
        onStartEdit={() => {
          setIsEditingTitle(true);
        }}
        onStopEdit={() => {
          setIsEditingTitle(false);
        }}
        onTitleUpdate={handleTitleUpdate}
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
