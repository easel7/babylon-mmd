import wasmPackPlugin from "@wasm-tool/wasm-pack-plugin";
import compressionWebpackPlugin from "compression-webpack-plugin";
import copyWebpackPlugin from "copy-webpack-plugin";
import eslintPlugin from "eslint-webpack-plugin";
import htmlWebpackPlugin from "html-webpack-plugin";
import path from "path";
import type ts from "typescript";
import glslMinifyTransformer from "typescript-glslminify-transformer";
import type webpack from "webpack";
import type { Configuration as WebpackDevServerConfiguration } from "webpack-dev-server";

export default (env: any): webpack.Configuration & { devServer?: WebpackDevServerConfiguration } => ({
    entry: "./src/Test/index.ts",
    output: {
        path: path.join(__dirname, "/test_dist"),
        filename: "[name].bundle.js",
        clean: true
    },
    optimization: {
        minimize: env.production
    },
    cache: true,
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: "ts-loader",
                options: {
                    getCustomTransformers: (program: ts.Program) => ({
                        before: [glslMinifyTransformer(program)]
                    })
                }
            },
            {
                test: /\.html$/,
                loader: "html-loader"
            }
        ]
    },
    resolve: {
        alias: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            "@": path.resolve(__dirname, "src")
        },
        modules: ["src", "node_modules"],
        extensions: [".js", ".jsx", ".ts", ".tsx"],
        fallback: {
            "url": require.resolve("url/")
        }
    },
    plugins: [
        new htmlWebpackPlugin({
            template: "./src/Test/index.html"
        }),
        new eslintPlugin({
            extensions: ["ts", "tsx"],
            fix: true,
            cache: true
        }),
        new copyWebpackPlugin({
            patterns: [
                { from: "res", to: "res" }
            ]
        }),
        // new wasmPackPlugin({
        //     crateDirectory: path.resolve(__dirname, "src/Runtime/Optimized/wasm_src"),
        //     outDir: path.resolve(__dirname, "src/Runtime/Optimized/wasm"),
        //     outName: "index",
        //     extraArgs: "--target web",
        //     forceMode: "production"
        // }),
        new wasmPackPlugin({
            crateDirectory: path.resolve(__dirname, "src/Runtime/Optimized/wasm_src"),
            outDir: path.resolve(__dirname, "src/Runtime/Optimized/wasm_debug"),
            outName: "index",
            extraArgs: "--target web",
            forceMode: "development"
        })
    ].concat(env.production ? [
        new compressionWebpackPlugin({
            test: /\.(js|bvmd|bpmx)$/i
        }) as any
    ] : []),
    devServer: {
        host: "0.0.0.0",
        port: 20310,
        allowedHosts: "all",
        client: {
            logging: "none"
        },
        hot: true,
        watchFiles: ["src/**/*"],
        https: true,
        headers: {
            // eslint-disable-next-line @typescript-eslint/naming-convention
            "Cross-Origin-Opener-Policy": "same-origin",
            // eslint-disable-next-line @typescript-eslint/naming-convention
            "Cross-Origin-Embedder-Policy": "require-corp"
        }
    },
    stats: {
        warningsFilter: [
            "Circular dependency between chunks with runtime"
        ]
    },
    mode: env.production ? "production" : "development"
});
