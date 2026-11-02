@file:Suppress("DEPRECATION", "DEPRECATION_ERROR")

package dev.androidperformance.compiler

import org.jetbrains.kotlin.backend.common.extensions.IrGenerationExtension
import org.jetbrains.kotlin.backend.common.extensions.IrPluginContext
import org.jetbrains.kotlin.compiler.plugin.CompilerPluginRegistrar
import org.jetbrains.kotlin.compiler.plugin.ExperimentalCompilerApi
import org.jetbrains.kotlin.config.CompilerConfiguration
import org.jetbrains.kotlin.ir.IrStatement
import org.jetbrains.kotlin.ir.declarations.IrModuleFragment
import org.jetbrains.kotlin.ir.declarations.IrSimpleFunction
import org.jetbrains.kotlin.ir.expressions.IrBlockBody
import org.jetbrains.kotlin.ir.expressions.IrExpression
import org.jetbrains.kotlin.ir.symbols.UnsafeDuringIrConstructionAPI
import org.jetbrains.kotlin.ir.util.fqNameWhenAvailable
import org.jetbrains.kotlin.ir.util.parentAsClass
import org.jetbrains.kotlin.ir.visitors.IrElementTransformerVoid
import org.jetbrains.kotlin.ir.visitors.transformChildrenVoid
import org.jetbrains.kotlin.name.CallableId
import org.jetbrains.kotlin.name.FqName
import org.jetbrains.kotlin.name.Name

@OptIn(ExperimentalCompilerApi::class)
class ApwComposeInstrumentationRegistrar : CompilerPluginRegistrar() {
    override val supportsK2: Boolean = true

    override fun ExtensionStorage.registerExtensions(configuration: CompilerConfiguration) {
        IrGenerationExtension.registerExtension(ApwComposeInstrumentationExtension())
    }
}

private class ApwComposeInstrumentationExtension : IrGenerationExtension {
    @OptIn(UnsafeDuringIrConstructionAPI::class)
    override fun generate(moduleFragment: IrModuleFragment, pluginContext: IrPluginContext) {
        val record = pluginContext.referenceFunctions(
            CallableId(FqName("dev.androidperformance.agent"), Name.identifier("apwComposeAutomaticInvocation"))
        ).singleOrNull() ?: return
        val composable = FqName("androidx.compose.runtime.Composable")
        moduleFragment.transformChildrenVoid(object : IrElementTransformerVoid() {
            override fun visitSimpleFunction(declaration: IrSimpleFunction): IrStatement {
                val transformed = super.visitSimpleFunction(declaration)
                if (declaration.body == null || declaration.annotations.none {
                        it.symbol.owner.parentAsClass.fqNameWhenAvailable == composable
                    }) return transformed
                // Avoid recursively instrumenting the runtime helper if a target also marks it Composable.
                if (declaration.fqNameWhenAvailable?.asString()?.startsWith("dev.androidperformance.agent.") == true) return transformed
                val body = declaration.body as? IrBlockBody ?: return transformed
                val signature = (declaration.fqNameWhenAvailable?.asString() ?: declaration.name.asString()).take(300)
                val call = IrCalls.stringCall(
                    declaration.startOffset, declaration.endOffset,
                    pluginContext.irBuiltIns.unitType, pluginContext.irBuiltIns.stringType, record, signature
                )
                // The Compose compiler lowers its skip branch after this extension runs. This records
                // function invocation, so a call that the Composer skips later is included.
                body.statements.add(0, call)
                return transformed
            }
        })
    }
}
