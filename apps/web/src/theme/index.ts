import { createTheme, type ThemeOptions as MuiThemeOptions } from "@mui/material";

// Custom tokens accessible via theme.custom.*
declare module "@mui/material/styles" {
  interface Theme {
    custom: {
      iconSize: { sm: number; md: number; lg: number; xl: number };
    };
  }
  interface ThemeOptions {
    custom?: Theme["custom"];
  }
}

// ============================================================================
// Dark-tokyo palette — Tokyo Night-inspired neutrals anchored on the logo
// purple, styled minimal: flat surfaces, hairline borders, restrained glow.
// ============================================================================

const tokyo = {
  bg: "#16161e",
  surface: "#1b1c26",
  surfaceHigh: "#20212e",
  line: "rgba(122, 162, 247, 0.14)",
  text: "#c0caf5",
  textDim: "#9aa5ce",
  purple: "#7c4dff",
  purpleSoft: "#bb9af7",
  cyan: "#7dcfff",
  blue: "#7aa2f7",
  green: "#9ece6a",
  amber: "#e0af68",
  pink: "#f7768e",
} as const;

const baseOptions: MuiThemeOptions = {
  palette: {
    mode: "dark",
    primary: { main: tokyo.purple, light: tokyo.purpleSoft },
    secondary: { main: tokyo.cyan },
    info: { main: tokyo.blue },
    success: { main: tokyo.green },
    warning: { main: tokyo.amber },
    error: { main: tokyo.pink },
    background: { default: tokyo.bg, paper: tokyo.surface },
    text: { primary: tokyo.text, secondary: tokyo.textDim },
    divider: tokyo.line,
  },
  custom: {
    iconSize: { sm: 16, md: 24, lg: 48, xl: 64 },
  },
  typography: {
    fontFamily: 'var(--font-inter), "Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    fontWeightMedium: 500,
    h1: { letterSpacing: "-0.02em" },
    h2: { letterSpacing: "-0.02em" },
    h3: { letterSpacing: "-0.02em" },
    h4: { letterSpacing: "-0.01em" },
    overline: { letterSpacing: "0.18em", fontWeight: 600 },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        "::selection": {
          backgroundColor: "rgba(124, 77, 255, 0.35)",
        },
        "*::-webkit-scrollbar": {
          width: 10,
          height: 10,
        },
        "*::-webkit-scrollbar-thumb": {
          backgroundColor: "rgba(122, 162, 247, 0.18)",
          borderRadius: 8,
          border: `2px solid ${tokyo.bg}`,
        },
        "*::-webkit-scrollbar-thumb:hover": {
          backgroundColor: "rgba(122, 162, 247, 0.32)",
        },
        "*": {
          scrollbarColor: `rgba(122, 162, 247, 0.18) transparent`,
          scrollbarWidth: "thin",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: { textTransform: "none" },
        containedPrimary: {
          "&:hover": {
            boxShadow: "0 0 18px rgba(124, 77, 255, 0.45)",
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        // Flat surfaces with hairline borders instead of elevation shadows
        root: {
          borderRadius: 12,
          backgroundImage: "none",
          border: `1px solid ${tokyo.line}`,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          border: "none",
          borderBottom: `1px solid ${tokyo.line}`,
        },
      },
    },
    MuiAccordion: {
      styleOverrides: {
        // Accordions are Papers; the hairline-border look is for surfaces,
        // not inline expanders (e.g. sidebar nav groups)
        root: {
          border: "none",
          borderRadius: 8,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          border: "none",
          borderRight: `1px solid ${tokyo.line}`,
          borderRadius: 0,
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: { backgroundColor: tokyo.surfaceHigh },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": { borderRadius: 8 },
        },
      },
    },
    MuiDialog: {
      defaultProps: {
        maxWidth: "sm",
        fullWidth: true,
      },
    },
    MuiIconButton: {
      defaultProps: {
        size: "small",
      },
    },
    MuiChip: {
      defaultProps: {
        size: "small",
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: { borderRadius: 8 },
      },
    },
  },
};

export const theme = createTheme(baseOptions);
