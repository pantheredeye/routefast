import { defineApp, ErrorResponse } from "rwsdk/worker";
import { route, render, prefix, layout } from "rwsdk/router";
import { Document } from "@/app/Document";
import { ChatLayout } from "@/app/ChatLayout";
import { Home } from "@/app/pages/Home";
import { setCommonHeaders } from "@/app/headers";
import { userRoutes } from "@/app/pages/user/routes";
import { routeCalculatorRoutes } from "@/addons/route-calculator/routes";
import { agentRoutes } from "@/addons/agent/routes";
import { subscriptionRoutes } from "@/addons/subscription/routes";
import landingRoutes from "@/app/pages/landing/routes";
import aboutRoutes from "@/app/pages/about/routes";
import { accountRoutes } from "@/app/pages/account/routes";
import { legalRoutes } from "@/app/pages/legal/routes";
import { shareRoutes } from "@/app/pages/share/routes";
import { appleAppSiteAssociation, androidAssetLinks } from "@/app/deepLinks";
import { magicVerifyHandler, authStatusHandler } from "@/app/pages/user/authApi";
import { sessions, setupSessionStore } from "./session/store";
import { Session } from "./session/durableObject";
import { type User, type Tenant, type TenantMembership, db, setupDb } from "@/db";
import { env } from "cloudflare:workers";
import { runReminderCron } from "@/addons/agent/server-functions/reminderCron";
import { runDailyDigest } from "@/addons/agent/server-functions/dailyDigest";
export { SessionDurableObject } from "./session/durableObject";
export { AgentStateDO } from "./addons/agent/durableObject";

export type AppContext = {
  session: Session | null;
  user: User | null;
  tenant: Tenant | null;
  membership: TenantMembership | null;
};

const app = defineApp([
  setCommonHeaders(),
  async ({ ctx, request, response, isAction }) => {
    await setupDb(env);

    setupSessionStore(env);

    try {
      ctx.session = await sessions.load(request);
    } catch (error) {
      if (error instanceof ErrorResponse && error.code === 401) {
        // Skip redirects for actions - they should throw/return error
        if (isAction) {
          throw error;
        }

        await sessions.remove(request, response.headers);
        response.headers.set("Location", "/user/auth");

        return new Response(null, {
          status: 302,
          headers: response.headers,
        });
      }

      throw error;
    }

    if (ctx.session?.userId) {
      ctx.user = await db.user.findUnique({
        where: {
          id: ctx.session.userId,
        },
      });

      // Load tenant and membership if available in session
      if (ctx.session.tenantId && ctx.session.membershipId) {
        ctx.tenant = await db.tenant.findUnique({
          where: {
            id: ctx.session.tenantId,
          },
        });

        ctx.membership = await db.tenantMembership.findUnique({
          where: {
            id: ctx.session.membershipId,
          },
        });
      }
    }
  },
  route("/.well-known/apple-app-site-association", () =>
    Response.json(appleAppSiteAssociation),
  ),
  route("/.well-known/assetlinks.json", () =>
    Response.json(androidAssetLinks),
  ),
  route("/api/auth/magic/verify", magicVerifyHandler),
  route("/api/auth/status", authStatusHandler),
  prefix("/agent", agentRoutes),
  render(Document, [
    layout(ChatLayout, [
    ...landingRoutes,
    ...aboutRoutes,
    route("/signup", () => {
      return new Response(null, {
        status: 302,
        headers: { Location: "/user/auth" },
      });
    }),
    route("/login", () => {
      return new Response(null, {
        status: 302,
        headers: { Location: "/user/auth" },
      });
    }),
    route("/protected", [
      ({ ctx }) => {
        if (!ctx.user) {
          return new Response(null, {
            status: 302,
            headers: { Location: "/user/auth" },
          });
        }
      },
      Home,
    ]),
    prefix("/user", userRoutes),
    prefix("/subscription", subscriptionRoutes),
    prefix("/route", routeCalculatorRoutes),
    prefix("/account", accountRoutes),
    prefix("/legal", legalRoutes),
    prefix("/share", shareRoutes),
    route("*", () => new Response("Not Found", { status: 404 })),
    ]),
  ]),
]);

export default {
  fetch: app.fetch,
  async scheduled(
    event: ScheduledController,
    _env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    await setupDb(env);
    if (event.cron === "*/5 * * * *") {
      ctx.waitUntil(runReminderCron());
    } else if (event.cron === "0 12 * * *") {
      ctx.waitUntil(runDailyDigest());
    }
  },
} satisfies ExportedHandler<Env>;
