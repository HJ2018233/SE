import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Menu,
  MenuDivider,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Radio,
  RadioGroup,
  Tab,
  TabList,
  Text,
  Toast,
  Toaster,
  ToastTitle,
  ToastTrigger,
  useToastController,
} from "@fluentui/react-components";
import {
  Building24Regular,
  ChevronDown16Regular,
  Dismiss16Regular,
  Person24Regular,
} from "@fluentui/react-icons";
import { AppContext } from "./context";
import {
  api,
  ApiError,
  errorMessage,
  getToken,
  prototype,
  setToken,
} from "./api";
import type { Command, Credentials, Identity } from "./api";
import type { DemoData } from "./model";
import {
  expirePending,
  initialConditions,
  loadData,
  SESSION,
  STORAGE,
  SCENARIO,
  dateTime,
} from "./model";
import type { Role, Scenario } from "./model";
import { ConfirmDialog, Empty } from "./components/shared";
import {
  Explore,
  HotelPage,
  Booking,
  Orders,
  OrderDetail,
  ModifyOrder,
  AuthPage,
  AccountPage,
} from "./pages/customer";
import {
  CalendarPage,
  StaffOrders,
  HotelSettings,
  StatsPage,
  IncidentsPage,
  AuditPage,
  AdminHotels,
  AdminAccounts,
} from "./pages/management";

const customerTabs = [
  { path: "/explore", label: "探索酒店" },
  { path: "/orders", label: "我的订单" },
];
const staffTabs = [
  { path: "/staff/calendar", label: "房量日历" },
  { path: "/staff/orders", label: "订单处理" },
  { path: "/staff/hotel", label: "酒店与房型" },
  { path: "/staff/incidents", label: "异常处置" },
  { path: "/staff/stats", label: "统计与导出" },
  { path: "/staff/audit", label: "操作日志" },
];
const adminTabs = [
  { path: "/admin/incidents", label: "异常事件" },
  { path: "/admin/hotels", label: "酒店管理" },
  { path: "/admin/accounts", label: "账户与权限" },
  { path: "/admin/audit", label: "审计记录" },
];

const emptyData: DemoData = {
  connected: true,
  hotels: [],
  rooms: [],
  orders: [],
  calendar: {},
  incidents: [],
  audit: [],
  accounts: [],
};

export function App() {
  const [data, setData] = useState(() => (prototype ? loadData() : emptyData));
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState(prototype);
  const [initialError, setInitialError] = useState("");
  const refreshIndex = useRef(0);
  const [rawHash, setRawHash] = useState(
    () => window.location.hash.slice(1) || "/explore",
  );
  const [path, queryString = ""] = rawHash.split("?");
  const searchParams = useMemo(
    () => new URLSearchParams(queryString),
    [queryString],
  );
  const rawReturnTo = searchParams.get("returnTo") || "";
  const safeReturnTo =
    rawReturnTo.startsWith("/") &&
    !rawReturnTo.startsWith("//") &&
    rawReturnTo !== "/login" &&
    rawReturnTo !== "/register"
      ? rawReturnTo
      : undefined;
  const [conditions, setConditions] = useState(initialConditions);
  const [signedIn, setSignedIn] = useState(
    () => prototype && sessionStorage.getItem(SESSION) === "true",
  );
  const [scenario, setScenarioValue] = useState<Scenario>(
    () => (sessionStorage.getItem(SCENARIO) as Scenario) || "normal",
  );
  const [toolsOpen, setToolsOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const toasterId = useId();
  const { dispatchToast } = useToastController(toasterId);
  const mainRef = useRef<HTMLElement>(null);
  const routeRole: Role = path.startsWith("/staff")
    ? "staff"
    : path.startsWith("/admin")
      ? "admin"
      : "customer";
  const role = prototype ? routeRole : identity?.role || "customer";
  const staffHotel = prototype ? "qt" : identity?.hotel || "";
  const tabs =
    role === "staff" ? staffTabs : role === "admin" ? adminTabs : customerTabs;
  const selected =
    role === "customer"
      ? path.startsWith("/order") || path.startsWith("/modify")
        ? "/orders"
        : path === "/" ||
            path === "/explore" ||
            path.startsWith("/hotel/") ||
            path.startsWith("/book/")
          ? "/explore"
          : ""
      : path;
  const loginQuery = path.startsWith("/hotel/")
    ? `?returnTo=${encodeURIComponent(path)}`
    : "";
  useEffect(() => {
    const onHash = () => {
      setRawHash(window.location.hash.slice(1) || "/explore");
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!prototype) return;
    try {
      localStorage.setItem(STORAGE, JSON.stringify(data));
    } catch {
      /* The preview still works without persistent browser storage. */
    }
  }, [data]);
  useEffect(() => {
    if (!prototype) return;
    const timer = window.setInterval(() => setData(expirePending), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [path]);
  const go = useCallback((next: string) => {
    setRawHash(next);
    window.scrollTo(0, 0);
    if (window.location.hash !== `#${next}`) {
      window.location.hash = next;
    }
  }, []);
  const notify = useCallback(
    (
      text: string,
      intent: "success" | "error" | "warning" | "info" = "success",
    ) => {
      dispatchToast(
        <Toast>
          <ToastTitle
            action={
              <ToastTrigger>
                <Button
                  appearance="transparent"
                  size="small"
                  icon={<Dismiss16Regular />}
                  aria-label="关闭提示"
                />
              </ToastTrigger>
            }
          >
            {text}
          </ToastTitle>
        </Toast>,
        {
          intent,
          timeout: intent === "error" ? 6000 : 3800,
          pauseOnHover: true,
        },
      );
    },
    [dispatchToast],
  );
  const refresh = useCallback(async (): Promise<DemoData | null> => {
    if (prototype) {
      setData((current) => ({ ...current }));
      return null;
    }
    const request = ++refreshIndex.current;
    let token = getToken();
    try {
      let next;
      try {
        next = await api.state(token);
      } catch (error) {
        if (
          !(error instanceof ApiError) ||
          error.status !== 401 ||
          getToken() !== token
        )
          throw error;
        setToken("");
        token = "";
        setIdentity(null);
        setSignedIn(false);
        setData(emptyData);
        next = await api.state("");
      }
      if (request !== refreshIndex.current || getToken() !== token) return null;
      const nextData: DemoData = { ...next, connected: true };
      setData(nextData);
      setIdentity(next.account);
      setSignedIn(Boolean(next.account));
      setReady(true);
      setInitialError("");
      return nextData;
    } catch (error) {
      if (request === refreshIndex.current)
        setInitialError(errorMessage(error));
      return null;
    }
  }, []);
  useEffect(() => {
    if (prototype) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const signIn = async (
    login?: Credentials,
    register = false,
  ): Promise<Role> => {
    if (prototype) {
      sessionStorage.setItem(SESSION, "true");
      setSignedIn(true);
      return "customer";
    }
    if (!login) throw new Error("登录需要账户和密码");
    const res = await api.login(login, register);
    setToken(res.token);
    setIdentity(res.account);
    setSignedIn(true);
    setData(emptyData);
    setReady(false);
    await refresh();
    return res.account.role;
  };
  const signOut = () => {
    if (prototype) {
      sessionStorage.removeItem(SESSION);
    } else {
      const token = getToken();
      setToken("");
      setIdentity(null);
      setData(emptyData);
      void api.logout(token).catch(() => undefined);
      void refresh();
    }
    setSignedIn(false);
    go("/explore");
  };
  const command = async (input: Command) => {
    try {
      const result = await api.command(input);
      await refresh();
      return result;
    } catch (error) {
      if (error instanceof ApiError && [401, 409].includes(error.status))
        void refresh();
      throw error;
    }
  };
  const audit = useCallback(
    (action: string, object: string, detail: string, result = "成功") =>
      setData((current) => ({
        ...current,
        audit: [
          {
            id: `LOG${Date.now()}`,
            at: dateTime(),
            role:
              role === "staff"
                ? "酒店工作人员"
                : role === "admin"
                  ? "平台管理员"
                  : "顾客",
            action,
            object,
            detail,
            result,
          },
          ...current.audit,
        ],
      })),
    [role],
  );
  const setScenario = (value: Scenario) => {
    setScenarioValue(value);
    sessionStorage.setItem(SCENARIO, value);
  };
  const switchRole = (next: Role) => {
    if (next !== "customer") void signIn();
    go(
      next === "staff"
        ? "/staff/calendar"
        : next === "admin"
          ? "/admin/incidents"
          : "/explore",
    );
  };
  const id = path.split("/")[2];
  const isCustomerRoute =
    path === "/" ||
    path === "/explore" ||
    path === "/orders" ||
    path === "/account" ||
    path.startsWith("/hotel/") ||
    path.startsWith("/book/") ||
    path.startsWith("/order/") ||
    path.startsWith("/modify/");
  const staffHotelPreview =
    role === "staff" && Boolean(staffHotel) && path === `/hotel/${staffHotel}`;
  const requiresSignIn =
    (!prototype && routeRole !== "customer") ||
    (role === "customer" &&
      ["/orders", "/order/", "/book/", "/modify/", "/account"].some(
        (prefix) => path === prefix || path.startsWith(prefix),
      ));
  let page;
  if (!ready)
    page = (
      <Empty title={initialError ? "连接服务失败" : "正在载入"}>
        {initialError && (
          <>
            <p>{initialError}</p>
            <Button onClick={() => void refresh()}>重试</Button>
          </>
        )}
      </Empty>
    );
  else if (requiresSignIn && !signedIn) page = <AuthPage returnTo={path} />;
  else if (!prototype && routeRole !== "customer" && routeRole !== role)
    page = (
      <Empty
        title="此页面需要相应账户权限"
        action={<Button onClick={() => go(tabs[0].path)}>返回工作台</Button>}
      />
    );
  else if (!prototype && role !== "customer" && isCustomerRoute && !staffHotelPreview)
    page = (
      <Empty
        title="此页面仅限顾客账户访问"
        action={
          <Button appearance="primary" onClick={() => go(tabs[0].path)}>
            返回工作台
          </Button>
        }
      >
        当前以{role === "staff" ? "酒店工作人员" : "平台管理员"}
        身份登录，如需体验顾客预订流程，请退出后使用顾客账户。
      </Empty>
    );
  else if (path === "/explore" || path === "/") page = <Explore />;
  else if (path.startsWith("/hotel/")) page = <HotelPage key={id} id={id} />;
  else if (path.startsWith("/book/")) page = <Booking key={id} id={id} />;
  else if (path === "/orders") page = <Orders />;
  else if (path.startsWith("/order/")) page = <OrderDetail key={id} id={id} />;
  else if (path.startsWith("/modify/")) page = <ModifyOrder key={id} id={id} />;
  else if (path === "/login" || path === "/register")
    page = (
      <AuthPage
        key={`${path}-${safeReturnTo || ""}`}
        register={path === "/register"}
        returnTo={safeReturnTo}
      />
    );
  else if (path === "/account") page = <AccountPage />;
  else if (path === "/staff/calendar")
    page = (
      <CalendarPage
        initialDate={searchParams.get("date") || undefined}
        scheduleRoom={searchParams.get("scheduleRoom") || undefined}
      />
    );
  else if (path === "/staff/orders") page = <StaffOrders />;
  else if (path === "/staff/hotel") page = <HotelSettings />;
  else if (path === "/staff/stats") page = <StatsPage />;
  else if (path === "/staff/incidents" || path === "/admin/incidents")
    page = <IncidentsPage initialId={searchParams.get("id") || undefined} />;
  else if (path === "/staff/audit" || path === "/admin/audit")
    page = <AuditPage />;
  else if (path === "/admin/hotels") page = <AdminHotels />;
  else if (path === "/admin/accounts") page = <AdminAccounts />;
  else
    page =
      role === "customer" ? (
        <Explore />
      ) : (
        <Empty
          title="页面不存在"
          action={<Button onClick={() => go(tabs[0].path)}>返回工作台</Button>}
        />
      );
  if (
    prototype &&
    role === "staff" &&
    !data.accounts.find((a) => a.id === "ST001")?.enabled
  )
    page = (
      <Empty title="工作人员示例账户已停用">
        请在平台管理员视图中核对账户状态。
      </Empty>
    );
  return (
    <AppContext.Provider
      value={{
        data,
        update: setData,
        audit,
        role,
        signedIn,
        identity,
        connected: !prototype,
        staffHotel,
        refresh,
        command,
        signIn,
        signOut,
        go,
        path,
        conditions,
        setConditions,
        scenario,
        setScenario,
        notify,
      }}
    >
      <div className={`app-shell role-${role}`}>
        <a
          href="#main-content"
          className="skip-link"
          onClick={(event) => {
            event.preventDefault();
            mainRef.current?.focus();
          }}
        >
          跳到主要内容
        </a>
        <header className={`app-header ${scrolled ? "scrolled" : ""}`}>
          <div className="header-inner">
            <div className="brand-group">
              <Button
                appearance="transparent"
                className="brand"
                onClick={() =>
                  go(role === "customer" ? "/explore" : tabs[0].path)
                }
              >
                <span className="brand-symbol">
                  <Building24Regular />
                </span>
                <Text weight="semibold" size={400}>
                  酒店预订系统
                </Text>
              </Button>
              {role !== "customer" && (
                <Badge appearance="tint" color="brand" className="role-pill">
                  {role === "staff" ? "酒店工作台" : "平台管理台"}
                </Badge>
              )}
            </div>
            <nav aria-label="主要导航" className="desktop-navigation">
              <TabList
                selectedValue={selected}
                onTabSelect={(_, d) => go(String(d.value))}
              >
                {tabs.map((tab) => (
                  <Tab key={tab.path} value={tab.path}>
                    {tab.label}
                  </Tab>
                ))}
              </TabList>
            </nav>
            <div className="header-account">
              {!prototype && role === "customer" && !signedIn ? (
                <>
                  <Button
                    appearance="subtle"
                    onClick={() => go(`/register${loginQuery}`)}
                  >
                    注册
                  </Button>
                  <Button
                    appearance="primary"
                    onClick={() => go(`/login${loginQuery}`)}
                    className="header-login"
                  >
                    登录
                  </Button>
                </>
              ) : (
                <>
                  <Menu>
                    <MenuTrigger disableButtonEnhancement>
                      <Button
                        appearance="subtle"
                        aria-label={`${role === "staff" ? "酒店工作台" : role === "admin" ? "平台管理" : signedIn ? "我的账户" : "访客"}，打开账户菜单${prototype ? "与原型视图" : ""}`}
                        icon={
                          signedIn ? (
                            <Avatar
                              name={
                                role === "staff"
                                  ? "酒店"
                                  : role === "admin"
                                    ? "管理"
                                    : "顾客"
                              }
                              size={28}
                            />
                          ) : (
                            <Person24Regular />
                          )
                        }
                      >
                        <span className="account-label">
                          {role === "staff"
                            ? (data.hotels.find((h) => h.id === staffHotel)?.name ||
                                "酒店") + " · 工作台"
                            : role === "admin"
                              ? "平台管理"
                              : signedIn
                                ? "我的账户"
                                : "访客"}
                        </span>
                        <ChevronDown16Regular />
                      </Button>
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>
                        {role === "customer" && (
                          <MenuItem
                            onClick={() =>
                              go(signedIn ? "/account" : `/login${loginQuery}`)
                            }
                          >
                            {signedIn ? "个人中心" : "登录 / 注册"}
                          </MenuItem>
                        )}
                        {prototype && (
                          <>
                            <MenuDivider />
                            <MenuItem onClick={() => switchRole("customer")}>
                              顾客视图（原型演示）
                            </MenuItem>
                            <MenuItem onClick={() => switchRole("staff")}>
                              酒店工作人员视图（原型演示）
                            </MenuItem>
                            <MenuItem onClick={() => switchRole("admin")}>
                              平台管理员视图（原型演示）
                            </MenuItem>
                            <MenuDivider />
                            <MenuItem onClick={() => setToolsOpen(true)}>
                              原型场景
                            </MenuItem>
                          </>
                        )}
                        {signedIn && (
                          <MenuItem onClick={signOut}>
                            {prototype ? "退出演示账户" : "退出登录"}
                          </MenuItem>
                        )}
                      </MenuList>
                    </MenuPopover>
                  </Menu>
                  {role === "customer" && !signedIn && (
                    <Button
                      appearance="primary"
                      onClick={() => go(`/login${loginQuery}`)}
                      className="header-login"
                    >
                      登录
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </header>
        <nav className="compact-navigation" aria-label="页面导航">
          <TabList
            selectedValue={selected}
            onTabSelect={(_, d) => go(String(d.value))}
          >
            {tabs.map((tab) => (
              <Tab key={tab.path} value={tab.path}>
                {tab.label}
              </Tab>
            ))}
          </TabList>
        </nav>
        <main
          id="main-content"
          data-route={path}
          tabIndex={-1}
          ref={mainRef}
          className="main-content"
        >
          {page}
        </main>
        <Toaster toasterId={toasterId} position="top-end" />
        <footer className="app-footer">
          <span>
            {prototype
              ? "界面原型 · 酒店、联系人与报价均为演示数据"
              : "酒店预订系统"}
          </span>
          <div>
            <span>北京时间 · 人民币</span>
            {prototype && (
              <Button
                size="small"
                appearance="subtle"
                onClick={() => setToolsOpen(true)}
              >
                原型场景
              </Button>
            )}
          </div>
        </footer>
      </div>
      <Dialog open={toolsOpen} onOpenChange={(_, d) => setToolsOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>原型演示</DialogTitle>
            <DialogContent>
              <p className="muted">
                切换角色以审阅各模块；以下场景作用于下一次新预订。操作仅保存在当前浏览器。
              </p>
              <Field label="预订反馈场景">
                <RadioGroup
                  value={scenario}
                  onChange={(_, d) => setScenario(d.value as Scenario)}
                >
                  <Radio value="normal" label="正常提交与酒店确认" />
                  <Radio value="price" label="提交时价格变化，需重新同意" />
                  <Radio value="unavailable" label="提交时某一晚已无房" />
                  <Radio value="uncertain" label="结果暂未显示，可查回原订单" />
                </RadioGroup>
              </Field>
              <div className="button-row space-top">
                <Button
                  onClick={() => {
                    switchRole("customer");
                    setToolsOpen(false);
                  }}
                >
                  顾客
                </Button>
                <Button
                  onClick={() => {
                    switchRole("staff");
                    setToolsOpen(false);
                  }}
                >
                  工作人员
                </Button>
                <Button
                  onClick={() => {
                    switchRole("admin");
                    setToolsOpen(false);
                  }}
                >
                  管理员
                </Button>
              </div>
            </DialogContent>
            <DialogActions>
              <Button
                onClick={() => {
                  setToolsOpen(false);
                  setResetOpen(true);
                }}
              >
                重置演示数据
              </Button>
              <Button appearance="primary" onClick={() => setToolsOpen(false)}>
                开始体验
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <ConfirmDialog
        open={resetOpen}
        title="恢复初始演示数据？"
        confirm="确认重置"
        onClose={() => setResetOpen(false)}
        onConfirm={() => {
          localStorage.removeItem(STORAGE);
          sessionStorage.removeItem(SCENARIO);
          window.location.reload();
        }}
      >
        重置会清除这个浏览器中的原型操作，恢复初始示例。
      </ConfirmDialog>
    </AppContext.Provider>
  );
}
